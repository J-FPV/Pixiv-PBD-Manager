"""Update-check and update-download workflows.

These walk the on-disk artist DB rather than the local filesystem; the scan
pipeline (``_scan_pipeline``) is unrelated.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .. import downloader, resolver
from ..database import ArtistDatabase
from ..downloader import ArtworkDownloadResult
from ..models import utc_now
from ._shared import ProgressCallback, collect_local_work_ids, emit

# ``fetch_user_work_ids`` and ``download_artwork`` are looked up via their
# parent modules at call time so tests can patch
# ``pixiv_pbd_manager.resolver.fetch_user_work_ids`` and
# ``pixiv_pbd_manager.downloader.download_artwork`` and see the patch take
# effect through this module. The ``ArtworkDownloadResult`` type import above
# is plain because it's only used in type position.


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
            remote = resolver.fetch_user_work_ids(
                artist.id,
                cookie=pixiv_cookie,
                allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
                max_pages=max_pages,
            )
        except resolver.PixivResolveError as exc:
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

            artwork_result = downloader.download_artwork(
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
