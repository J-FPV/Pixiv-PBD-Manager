from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from .database import ArtistDatabase
from .downloader import ArtworkDownloadResult, download_artwork
from .models import utc_now
from .resolver import PixivResolveError, fetch_user_work_ids, resolve_name_by_fuzzy_search, resolve_name_only_artist
from .scanner import ScanSummary, extract_work_ids, iter_media_files, scan_roots


ProgressCallback = Callable[[str, dict[str, object]], None]


def collect_local_work_ids(save_paths: list[str]) -> set[str]:
    """Scan an artist's saved folder(s) recursively and collect work ids on disk."""
    ids: set[str] = set()
    for raw in save_paths:
        folder = Path(raw)
        if not folder.exists():
            continue
        for path in iter_media_files(folder):
            ids.update(extract_work_ids(path))
    return ids


def emit(progress_callback: ProgressCallback | None, key: str, **kwargs: object) -> None:
    if progress_callback:
        progress_callback(key, kwargs)


@dataclass
class ScanResult:
    summary: ScanSummary
    changed: int
    db_path: Path
    resolved_name_only: int = 0
    fuzzy_resolved_name_only: int = 0
    ssl_fallback_used: int = 0
    resolve_errors: list[str] = field(default_factory=list)


@dataclass
class UpdateCheckResult:
    checked: int = 0
    artists_with_updates: int = 0
    new_works: int = 0
    ssl_fallback_used: int = 0
    errors: list[str] = field(default_factory=list)


@dataclass
class DownloadUpdatesResult:
    artists: int = 0
    artworks: int = 0
    pages_saved: int = 0
    files_skipped: int = 0
    ssl_fallback_used: int = 0
    artwork_results: list[ArtworkDownloadResult] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def scan_into_database(
    roots: list[Path],
    db_path: Path,
    *,
    resolve_online: bool = False,
    resolve_limit: int = 3,
    resolve_delay: float = 0.8,
    pixiv_cookie: str | None = None,
    allow_insecure_ssl_fallback: bool = True,
    exclude_roots: list[Path] | None = None,
    fuzzy_search_names: bool = False,
    fuzzy_min_score: float = 0.35,
    progress_callback: ProgressCallback | None = None,
) -> ScanResult:
    db = ArtistDatabase.load(db_path)
    emit(progress_callback, "progress_scan_start", roots=len(roots))
    summary = scan_roots(
        roots,
        exclude_roots=exclude_roots,
        progress_callback=lambda item: emit(
            progress_callback,
            "progress_scan_files",
            files=item.files_seen,
            matched=item.files_matched,
            name_only=len(item.name_only_artists),
        ),
    )
    emit(
        progress_callback,
        "progress_scan_done",
        files=summary.files_seen,
        matched=summary.files_matched,
        name_only=len(summary.name_only_artists),
    )
    changed = 0
    resolved_name_only = 0
    fuzzy_resolved_name_only = 0
    ssl_fallback_used = 0
    resolve_errors: list[str] = []
    resolved_hit_keys: set[str] = set()

    for artist_id, hit in summary.artists.items():
        if db.upsert(
            artist_id,
            name=hit.artist_name,
            source=hit.source,
            root=hit.root,
            save_path=hit.folder,
            work_ids=hit.work_ids,
        ):
            changed += 1

    if resolve_online:
        name_only_hits = list(summary.name_only_artists.values())
        for index, hit in enumerate(name_only_hits, 1):
            if not hit.work_ids:
                continue
            emit(progress_callback, "progress_resolve_artist", current=index, total=len(name_only_hits), name=hit.artist_name)
            try:
                resolved = resolve_name_only_artist(
                    hit,
                    max_work_ids=max(1, resolve_limit),
                    delay_seconds=max(0.0, resolve_delay),
                    cookie=pixiv_cookie,
                    allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
                )
            except PixivResolveError as exc:
                resolve_errors.append(str(exc))
                break
            if not resolved:
                continue
            if resolved.ssl_fallback_used:
                ssl_fallback_used += 1
            source = f"{hit.source};resolved_by_work:{resolved.work_id}"
            if db.upsert(
                resolved.id,
                name=resolved.name or hit.artist_name,
                source=source,
                root=hit.root,
                save_path=hit.folder,
                work_ids=hit.work_ids,
            ):
                changed += 1
            resolved_name_only += 1
            resolved_hit_keys.add(hit.artist_key)

    if resolve_online and fuzzy_search_names:
        name_only_hits = list(summary.name_only_artists.values())
        for index, hit in enumerate(name_only_hits, 1):
            if hit.artist_key in resolved_hit_keys:
                continue
            emit(progress_callback, "progress_fuzzy_artist", current=index, total=len(name_only_hits), name=hit.artist_name)
            try:
                candidate = resolve_name_by_fuzzy_search(
                    hit.artist_name,
                    min_score=fuzzy_min_score,
                    cookie=pixiv_cookie,
                    allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
                )
            except PixivResolveError as exc:
                resolve_errors.append(str(exc))
                break
            if not candidate:
                continue
            if candidate.ssl_fallback_used:
                ssl_fallback_used += 1
            source = f"{hit.source};fuzzy_search:{hit.artist_name};score:{candidate.score:.2f}"
            if db.upsert(
                candidate.id,
                name=candidate.name or hit.artist_name,
                source=source,
                root=hit.root,
                save_path=hit.folder,
                work_ids=hit.work_ids,
            ):
                changed += 1
            fuzzy_resolved_name_only += 1

    db.save()
    return ScanResult(
        summary=summary,
        changed=changed,
        db_path=db.path.resolve(),
        resolved_name_only=resolved_name_only,
        fuzzy_resolved_name_only=fuzzy_resolved_name_only,
        ssl_fallback_used=ssl_fallback_used,
        resolve_errors=resolve_errors,
    )


def check_artist_updates(
    db_path: Path,
    *,
    artist_ids: list[str] | None = None,
    pixiv_cookie: str | None = None,
    allow_insecure_ssl_fallback: bool = True,
    scan_local: bool = False,
    progress_callback: ProgressCallback | None = None,
) -> UpdateCheckResult:
    db = ArtistDatabase.load(db_path)
    artists = db.get_many(artist_ids or None)
    result = UpdateCheckResult()

    emit(progress_callback, "progress_check_start", total=len(artists))
    for index, artist in enumerate(artists, 1):
        emit(progress_callback, "progress_check_artist", current=index, total=len(artists), artist=artist.name or artist.id)
        if scan_local:
            local_ids = collect_local_work_ids(artist.save_paths)
            if local_ids:
                artist.merge(work_ids=local_ids)
        try:
            remote = fetch_user_work_ids(
                artist.id,
                cookie=pixiv_cookie,
                allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
            )
        except PixivResolveError as exc:
            result.errors.append(str(exc))
            continue
        if remote.ssl_fallback_used:
            result.ssl_fallback_used += 1
        artist.update_remote_work_ids(remote.work_ids)
        result.checked += 1
        if artist.new_work_ids:
            result.artists_with_updates += 1
            result.new_works += len(artist.new_work_ids)
            emit(progress_callback, "progress_check_found", artist=artist.name or artist.id, count=len(artist.new_work_ids))

    if result.checked:
        # Touch the records through their own fields; database save persists pending update state.
        for artist in artists:
            artist.last_checked = artist.last_checked or utc_now()
        db.save()
    return result


def download_artist_updates(
    db_path: Path,
    *,
    artist_ids: list[str] | None = None,
    output_root: Path | None = None,
    pixiv_cookie: str | None = None,
    allow_insecure_ssl_fallback: bool = True,
    overwrite: bool = False,
    delay_seconds: float = 0.3,
    separate_restricted: bool = False,
    progress_callback: ProgressCallback | None = None,
) -> DownloadUpdatesResult:
    db = ArtistDatabase.load(db_path)
    artists = db.get_many(artist_ids or None)
    result = DownloadUpdatesResult()
    downloadable_artists = [artist for artist in artists if artist.new_work_ids]
    emit(progress_callback, "progress_download_start", artists=len(downloadable_artists))

    for artist_index, artist in enumerate(downloadable_artists, 1):
        if not artist.new_work_ids:
            continue
        emit(
            progress_callback,
            "progress_download_artist",
            current=artist_index,
            total=len(downloadable_artists),
            artist=artist.name or artist.id,
            works=len(artist.new_work_ids),
        )
        save_path = Path(artist.save_paths[0]) if artist.save_paths else None
        if not save_path:
            if not output_root:
                result.errors.append(f"{artist.id}: no saved path; provide output root")
                continue
            save_path = output_root / f"{artist.name or 'artist'}-{artist.id}"
        save_path.mkdir(parents=True, exist_ok=True)

        artist_had_download = False
        completed_work_ids: set[str] = set()
        pending_work_ids = list(artist.new_work_ids)
        for work_index, work_id in enumerate(pending_work_ids, 1):
            emit(
                progress_callback,
                "progress_download_work",
                current=work_index,
                total=len(pending_work_ids),
                artist=artist.name or artist.id,
                work_id=work_id,
            )
            artwork_result = download_artwork(
                work_id,
                save_path,
                pixiv_cookie=pixiv_cookie,
                allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
                overwrite=overwrite,
                delay_seconds=delay_seconds,
                separate_restricted=separate_restricted,
            )
            result.artwork_results.append(artwork_result)
            if artwork_result.ssl_fallback_used:
                result.ssl_fallback_used += 1
            if artwork_result.error:
                result.errors.append(f"{artist.id}/{work_id}: {artwork_result.error}")
                emit(
                    progress_callback,
                    "progress_download_error",
                    artist=artist.name or artist.id,
                    work_id=work_id,
                    error=artwork_result.error,
                )
                continue
            completed_work_ids.add(str(work_id))
            result.artworks += 1
            result.pages_saved += len(artwork_result.saved_files)
            result.files_skipped += len(artwork_result.skipped_files)
            artist_had_download = True

        if completed_work_ids:
            artist.merge(work_ids=completed_work_ids, save_path=save_path)
        if artist_had_download:
            result.artists += 1

    db.save()
    return result
