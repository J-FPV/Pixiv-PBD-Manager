from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from .database import ArtistDatabase
from .downloader import ArtworkDownloadResult, download_artwork
from .models import ArtistRecord, utc_now
from .resolver import PixivResolveError, fetch_user_work_ids, resolve_name_by_fuzzy_search, resolve_name_only_artist
from .scanner import ScanSummary, extract_work_ids, is_relative_to, iter_media_files, scan_roots


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


def _known_save_roots(db: ArtistDatabase) -> list[Path]:
    roots: list[Path] = []
    for artist in db.artists.values():
        roots.extend(_artist_save_roots(artist))
    return roots


def _artist_save_roots(artist: ArtistRecord) -> list[Path]:
    return [Path(raw).expanduser().resolve() for raw in artist.save_paths if str(raw).strip()]


def _is_under_known_save_root(path: Path, save_roots: list[Path]) -> bool:
    resolved = path.expanduser().resolve()
    return any(resolved == root or is_relative_to(resolved, root) for root in save_roots)


def _is_under_artist_save_path(artist: ArtistRecord, path: Path | str | None) -> bool:
    if not path:
        return False
    return _is_under_known_save_root(Path(path), _artist_save_roots(artist))


def _filter_assigned_unmatched_folders(summary: ScanSummary, db: ArtistDatabase) -> None:
    save_roots = _known_save_roots(db)
    if not save_roots:
        return
    summary.unmatched_folders = {
        folder: count
        for folder, count in summary.unmatched_folders.items()
        if not _is_under_known_save_root(Path(folder), save_roots)
    }
    summary.unmatched_examples = [
        path for path in summary.unmatched_examples if not _is_under_known_save_root(path.parent, save_roots)
    ]


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
    _filter_assigned_unmatched_folders(summary, db)
    changed = 0
    resolved_name_only = 0
    fuzzy_resolved_name_only = 0
    ssl_fallback_used = 0
    resolve_errors: list[str] = []
    resolved_hit_keys: set[str] = set()

    for artist_id, hit in summary.artists.items():
        if _merge_scan_hit(
            db,
            artist_id=artist_id,
            artist_name=hit.artist_name,
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
            if _merge_scan_hit(
                db,
                artist_id=resolved.id,
                artist_name=resolved.name or hit.artist_name,
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
            if _merge_scan_hit(
                db,
                artist_id=candidate.id,
                artist_name=candidate.name or hit.artist_name,
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


@dataclass
class ScanPreviewResult:
    changes: list[dict] = field(default_factory=list)
    summary: ScanSummary | None = None
    resolved_name_only: int = 0
    fuzzy_resolved_name_only: int = 0
    ssl_fallback_used: int = 0
    resolve_errors: list[str] = field(default_factory=list)


@dataclass
class ScanApplyResult:
    applied: int = 0
    new_artists: int = 0
    name_changes: int = 0
    save_paths_added: int = 0
    work_ids_added: int = 0
    db_path: Path | None = None


def _accumulate_hit(
    proposed: dict[str, dict],
    artist_id: str,
    name: str | None,
    source: str | None,
    root,
    save_path,
    work_ids,
) -> None:
    bucket = proposed.setdefault(
        artist_id,
        {"name": "", "sources": [], "roots": [], "save_paths": [], "work_ids": set()},
    )
    if name and not bucket["name"]:
        bucket["name"] = name
    if source and source not in bucket["sources"]:
        bucket["sources"].append(source)
    if root:
        text = str(Path(root).resolve())
        if text not in bucket["roots"]:
            bucket["roots"].append(text)
    if save_path:
        text = str(Path(save_path).resolve())
        if text not in bucket["save_paths"]:
            bucket["save_paths"].append(text)
    if work_ids:
        bucket["work_ids"].update(str(w) for w in work_ids)


def _manual_replacement_for_artist_id(db: ArtistDatabase, artist_id: str) -> ArtistRecord | None:
    prefix = f"manual_id_edit:{artist_id}->"
    for artist in db.artists.values():
        if any(str(source).startswith(prefix) for source in artist.sources):
            return artist
    return None


def _existing_artist_for_save_paths(db: ArtistDatabase, save_paths: list[str]) -> ArtistRecord | None:
    proposed_paths = [Path(path).expanduser().resolve() for path in save_paths if path]
    if not proposed_paths:
        return None
    for artist in db.artists.values():
        existing_roots = _artist_save_roots(artist)
        if any(proposed == root or is_relative_to(proposed, root) for proposed in proposed_paths for root in existing_roots):
            return artist
    return None


def _existing_or_redirected_artist(
    db: ArtistDatabase,
    artist_id: str,
    save_paths: list[str],
) -> tuple[ArtistRecord | None, bool]:
    existing = db.artists.get(artist_id)
    if existing is not None:
        return existing, False
    replacement = _manual_replacement_for_artist_id(db, artist_id)
    if replacement is not None:
        return replacement, True
    existing_by_path = _existing_artist_for_save_paths(db, save_paths)
    if existing_by_path is not None:
        return existing_by_path, True
    return None, False


def _merge_scan_hit(
    db: ArtistDatabase,
    *,
    artist_id: str,
    artist_name: str | None,
    source: str,
    root,
    save_path,
    work_ids,
) -> bool:
    existing, redirected = _existing_or_redirected_artist(db, artist_id, [str(save_path)] if save_path else [])
    target_id = existing.id if existing else artist_id
    target_name = artist_name if existing is None or not existing.name else None
    target_save_path = None if existing and _is_under_artist_save_path(existing, save_path) else save_path
    target_source = f"{source};redirected_from:{artist_id}" if redirected else source
    return db.upsert(
        target_id,
        name=target_name,
        source=target_source,
        root=root,
        save_path=target_save_path,
        work_ids=work_ids,
    )


def preview_scan_changes(
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
) -> ScanPreviewResult:
    """Run the scan but produce a diff of proposed changes instead of writing.

    The diff items are stable JSON objects keyed by ``id`` that the GUI presents
    in a checkbox dialog; ``apply_scan_changes`` then writes only the user's
    selection. Existing names and save paths are never touched unless the user
    explicitly accepts the matching change.
    """
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
    _filter_assigned_unmatched_folders(summary, db)

    proposed: dict[str, dict] = {}
    for artist_id, hit in summary.artists.items():
        _accumulate_hit(proposed, artist_id, hit.artist_name, hit.source, hit.root, hit.folder, hit.work_ids)

    resolved_name_only = 0
    fuzzy_resolved_name_only = 0
    ssl_fallback_used = 0
    resolve_errors: list[str] = []
    resolved_hit_keys: set[str] = set()

    if resolve_online:
        name_only_hits = list(summary.name_only_artists.values())
        for index, hit in enumerate(name_only_hits, 1):
            if not hit.work_ids:
                continue
            emit(
                progress_callback,
                "progress_resolve_artist",
                current=index,
                total=len(name_only_hits),
                name=hit.artist_name,
            )
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
            _accumulate_hit(
                proposed,
                resolved.id,
                resolved.name or hit.artist_name,
                source,
                hit.root,
                hit.folder,
                hit.work_ids,
            )
            resolved_name_only += 1
            resolved_hit_keys.add(hit.artist_key)

    if resolve_online and fuzzy_search_names:
        name_only_hits = list(summary.name_only_artists.values())
        for index, hit in enumerate(name_only_hits, 1):
            if hit.artist_key in resolved_hit_keys:
                continue
            emit(
                progress_callback,
                "progress_fuzzy_artist",
                current=index,
                total=len(name_only_hits),
                name=hit.artist_name,
            )
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
            _accumulate_hit(
                proposed,
                candidate.id,
                candidate.name or hit.artist_name,
                source,
                hit.root,
                hit.folder,
                hit.work_ids,
            )
            fuzzy_resolved_name_only += 1

    changes: list[dict] = []
    for artist_id in sorted(proposed.keys(), key=lambda value: (len(value), value)):
        prop = proposed[artist_id]
        existing, redirected = _existing_or_redirected_artist(db, artist_id, list(prop["save_paths"]))
        if existing is None:
            changes.append(
                {
                    "id": f"new_artist:{artist_id}",
                    "kind": "new_artist",
                    "artist_id": artist_id,
                    "name": prop["name"],
                    "sources": list(prop["sources"]),
                    "roots": list(prop["roots"]),
                    "save_paths": list(prop["save_paths"]),
                    "work_ids": sorted(prop["work_ids"], key=lambda v: (len(v), v)),
                }
            )
            continue
        change_key = artist_id if not redirected else f"{artist_id}->{existing.id}"
        if not redirected and prop["name"] and prop["name"] != (existing.name or ""):
            changes.append(
                {
                    "id": f"name_change:{artist_id}",
                    "kind": "name_change",
                    "artist_id": artist_id,
                    "old_name": existing.name or "",
                    "new_name": prop["name"],
                }
            )
        existing_paths = set(existing.save_paths)
        added_paths = [
            p for p in prop["save_paths"] if p not in existing_paths and not _is_under_artist_save_path(existing, p)
        ]
        if added_paths:
            changes.append(
                {
                    "id": f"add_save_paths:{change_key}",
                    "kind": "add_save_paths",
                    "artist_id": existing.id,
                    "name": existing.name or "",
                    "existing": list(existing.save_paths),
                    "paths": added_paths,
                }
            )
        existing_works = set(existing.work_ids)
        added_works = sorted(prop["work_ids"] - existing_works, key=lambda v: (len(v), v))
        if added_works:
            changes.append(
                {
                    "id": f"add_work_ids:{change_key}",
                    "kind": "add_work_ids",
                    "artist_id": existing.id,
                    "name": existing.name or "",
                    "existing_count": len(existing.work_ids),
                    "work_ids": added_works,
                }
            )

    return ScanPreviewResult(
        changes=changes,
        summary=summary,
        resolved_name_only=resolved_name_only,
        fuzzy_resolved_name_only=fuzzy_resolved_name_only,
        ssl_fallback_used=ssl_fallback_used,
        resolve_errors=resolve_errors,
    )


def apply_scan_changes(db_path: Path, operations: list[dict]) -> ScanApplyResult:
    """Apply a user-selected subset of scan changes to the database."""
    db = ArtistDatabase.load(db_path)
    result = ScanApplyResult(db_path=db.path.resolve())

    for op in operations or []:
        kind = op.get("kind")
        artist_id = str(op.get("artist_id") or "").strip()
        if not artist_id.isdigit():
            continue

        if kind == "new_artist":
            artist = db.artists.get(artist_id)
            if artist is None:
                artist = ArtistRecord(id=artist_id, name=(op.get("name") or None))
                db.artists[artist_id] = artist
                result.new_artists += 1
            for src in op.get("sources") or []:
                if src and src not in artist.sources:
                    artist.sources.append(src)
            for root in op.get("roots") or []:
                if root and root not in artist.download_roots:
                    artist.download_roots.append(root)
            for sp in op.get("save_paths") or []:
                if sp and sp not in artist.save_paths:
                    artist.save_paths.append(sp)
            new_ids = {str(w) for w in op.get("work_ids") or []}
            if new_ids:
                existing_ids = set(artist.work_ids)
                added = new_ids - existing_ids
                if added:
                    artist.work_ids = sorted(existing_ids | added, key=lambda v: (len(v), v))
                    artist.new_work_ids = sorted(
                        set(artist.new_work_ids) - added, key=lambda v: (len(v), v)
                    )
            artist.last_seen = utc_now()
            result.applied += 1

        elif kind == "name_change":
            artist = db.artists.get(artist_id)
            new_name = (op.get("new_name") or "").strip()
            if artist and new_name and new_name != artist.name:
                artist.name = new_name
                artist.last_seen = utc_now()
                result.name_changes += 1
                result.applied += 1

        elif kind == "add_save_paths":
            artist = db.artists.get(artist_id)
            if artist:
                added_count = 0
                for path in op.get("paths") or []:
                    if path and path not in artist.save_paths:
                        artist.save_paths.append(path)
                        added_count += 1
                if added_count:
                    artist.last_seen = utc_now()
                    result.save_paths_added += added_count
                    result.applied += 1

        elif kind == "add_work_ids":
            artist = db.artists.get(artist_id)
            if artist:
                wanted = {str(w) for w in op.get("work_ids") or []}
                existing = set(artist.work_ids)
                added = wanted - existing
                if added:
                    artist.work_ids = sorted(existing | added, key=lambda v: (len(v), v))
                    artist.new_work_ids = sorted(
                        set(artist.new_work_ids) - added, key=lambda v: (len(v), v)
                    )
                    artist.last_seen = utc_now()
                    result.work_ids_added += len(added)
                    result.applied += 1

    db.save()
    return result


def check_artist_updates(
    db_path: Path,
    *,
    artist_ids: list[str] | None = None,
    pixiv_cookie: str | None = None,
    allow_insecure_ssl_fallback: bool = True,
    scan_local: bool = False,
    max_pages: int | None = None,
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
                max_pages=max_pages,
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
    total_works = sum(len(artist.new_work_ids) for artist in downloadable_artists)
    completed_works = 0
    emit(progress_callback, "progress_download_start", artists=len(downloadable_artists), total_works=total_works)

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
                global_current=completed_works + 1,
                global_total=total_works,
                artist=artist.name or artist.id,
                work_id=work_id,
            )

            def artwork_progress(key: str, payload: dict[str, object]) -> None:
                emit(progress_callback, key, artist=artist.name or artist.id, **payload)

            artwork_result = download_artwork(
                work_id,
                save_path,
                pixiv_cookie=pixiv_cookie,
                allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
                overwrite=overwrite,
                delay_seconds=delay_seconds,
                separate_restricted=separate_restricted,
                progress_callback=artwork_progress,
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
            else:
                completed_work_ids.add(str(work_id))
                result.artworks += 1
                result.pages_saved += len(artwork_result.saved_files)
                result.files_skipped += len(artwork_result.skipped_files)
                artist_had_download = True
            completed_works += 1
            emit(
                progress_callback,
                "progress_download_work_done",
                global_done=completed_works,
                global_total=total_works,
                artist=artist.name or artist.id,
                work_id=work_id,
            )

        if completed_work_ids:
            artist.merge(work_ids=completed_work_ids, save_path=save_path)
        if artist_had_download:
            result.artists += 1

    db.save()
    return result
