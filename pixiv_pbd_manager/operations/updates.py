"""Update-check and update-download workflows.

These walk the on-disk artist DB rather than the local filesystem; the scan
pipeline (``_scan_pipeline``) is unrelated.
"""

from __future__ import annotations

import queue
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path

from .. import downloader, resolver
from ..database import ArtistDatabase
from ..downloader import ArtworkDownloadResult
from ..events import (
    PROGRESS_CHECK_ARTIST,
    PROGRESS_CHECK_FOUND,
    PROGRESS_CHECK_START,
    PROGRESS_DOWNLOAD_ARTIST,
    PROGRESS_DOWNLOAD_ERROR,
    PROGRESS_DOWNLOAD_START,
    PROGRESS_DOWNLOAD_WORK,
    PROGRESS_DOWNLOAD_WORK_DONE,
)
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


MAX_DOWNLOAD_CONCURRENCY = 5


@dataclass(frozen=True)
class _DownloadTask:
    artist_id: str
    artist_label: str
    save_path: Path
    work_id: str
    work_index: int
    artist_work_total: int
    global_index: int
    global_total: int


@dataclass(frozen=True)
class _DownloadTaskResult:
    task: _DownloadTask
    artwork: ArtworkDownloadResult
    slot: int = 0


def normalize_download_concurrency(value: int | None) -> int:
    try:
        parsed = int(value or 1)
    except (TypeError, ValueError):
        return 1
    return max(1, min(MAX_DOWNLOAD_CONCURRENCY, parsed))


def _download_one_task(
    task: _DownloadTask,
    *,
    slot: int = 0,
    pixiv_cookie: str | None,
    allow_insecure_ssl_fallback: bool,
    overwrite: bool,
    delay_seconds: float,
    separate_restricted: bool,
    progress_callback: ProgressCallback | None,
) -> _DownloadTaskResult:
    # ``slot`` is this task's progress lane (0..concurrency-1) so the UI can show
    # one bar per concurrent download. Every event this task emits carries it.
    emit(
        progress_callback,
        PROGRESS_DOWNLOAD_WORK,
        slot=slot,
        current=task.work_index,
        total=task.artist_work_total,
        global_current=task.global_index,
        global_total=task.global_total,
        artist=task.artist_label,
        work_id=task.work_id,
    )

    def artwork_progress(key: str, payload: dict[str, object]) -> None:
        emit(progress_callback, key, artist=task.artist_label, slot=slot, **payload)

    try:
        artwork_result = downloader.download_artwork(
            task.work_id,
            task.save_path,
            pixiv_cookie=pixiv_cookie,
            allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
            overwrite=overwrite,
            delay_seconds=delay_seconds,
            separate_restricted=separate_restricted,
            progress_callback=artwork_progress,
        )
    except Exception as exc:  # pragma: no cover - defensive around external IO
        artwork_result = ArtworkDownloadResult(work_id=task.work_id, error=str(exc))
    return _DownloadTaskResult(task=task, artwork=artwork_result, slot=slot)


def check_artist_updates(
    db_path: Path,
    *,
    artist_ids: list[str] | None = None,
    pixiv_cookie: str | None = None,
    allow_insecure_ssl_fallback: bool = True,
    scan_local: bool = False,
    scan_local_depth: int | None = None,
    max_pages: int | None = None,
    progress_callback: ProgressCallback | None = None,
) -> UpdateCheckResult:
    db = ArtistDatabase.load(db_path)
    artists = db.get_many(artist_ids or None)
    result = UpdateCheckResult()

    emit(progress_callback, PROGRESS_CHECK_START, total=len(artists))
    for index, artist in enumerate(artists, 1):
        emit(progress_callback, PROGRESS_CHECK_ARTIST, current=index, total=len(artists), artist=artist.name or artist.id)
        local_ids = collect_local_work_ids(
            artist.save_paths,
            recursive=scan_local,
            max_depth=scan_local_depth,
        )
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
            emit(progress_callback, PROGRESS_CHECK_FOUND, artist=artist.name or artist.id, count=len(artist.new_work_ids))

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
    download_concurrency: int = 1,
    separate_restricted: bool = False,
    progress_callback: ProgressCallback | None = None,
) -> DownloadUpdatesResult:
    db = ArtistDatabase.load(db_path)
    artists = db.get_many(artist_ids or None)
    result = DownloadUpdatesResult()
    downloadable_artists = [artist for artist in artists if artist.new_work_ids]
    total_works = sum(len(artist.new_work_ids) for artist in downloadable_artists)
    completed_works = 0
    concurrency = normalize_download_concurrency(download_concurrency)
    emit(
        progress_callback,
        PROGRESS_DOWNLOAD_START,
        artists=len(downloadable_artists),
        total_works=total_works,
        concurrency=concurrency,
    )

    tasks: list[_DownloadTask] = []
    completed_by_artist: dict[str, set[str]] = {}
    downloaded_artists: set[str] = set()
    global_index = 0

    for artist_index, artist in enumerate(downloadable_artists, 1):
        if not artist.new_work_ids:
            continue
        artist_label = artist.name or artist.id
        emit(
            progress_callback,
            PROGRESS_DOWNLOAD_ARTIST,
            current=artist_index,
            total=len(downloadable_artists),
            artist=artist_label,
            works=len(artist.new_work_ids),
        )
        save_path = Path(artist.save_paths[0]) if artist.save_paths else None
        if not save_path:
            if not output_root:
                result.errors.append(f"{artist.id}: no saved path; provide output root")
                continue
            save_path = output_root / f"{artist.name or 'artist'}-{artist.id}"
        save_path.mkdir(parents=True, exist_ok=True)

        completed_by_artist[artist.id] = set()
        pending_work_ids = list(artist.new_work_ids)
        for work_index, work_id in enumerate(pending_work_ids, 1):
            global_index += 1
            tasks.append(
                _DownloadTask(
                    artist_id=artist.id,
                    artist_label=artist_label,
                    save_path=save_path,
                    work_id=str(work_id),
                    work_index=work_index,
                    artist_work_total=len(pending_work_ids),
                    global_index=global_index,
                    global_total=total_works,
                )
            )

    def record_task(task_result: _DownloadTaskResult) -> None:
        nonlocal completed_works
        task = task_result.task
        artwork_result = task_result.artwork
        result.artwork_results.append(artwork_result)
        if artwork_result.ssl_fallback_used:
            result.ssl_fallback_used += 1
        if artwork_result.error:
            result.errors.append(f"{task.artist_id}/{task.work_id}: {artwork_result.error}")
            emit(
                progress_callback,
                PROGRESS_DOWNLOAD_ERROR,
                artist=task.artist_label,
                work_id=task.work_id,
                error=artwork_result.error,
            )
        else:
            completed_by_artist.setdefault(task.artist_id, set()).add(str(task.work_id))
            result.artworks += 1
            result.pages_saved += len(artwork_result.saved_files)
            result.files_skipped += len(artwork_result.skipped_files)
            downloaded_artists.add(task.artist_id)
        completed_works += 1
        emit(
            progress_callback,
            PROGRESS_DOWNLOAD_WORK_DONE,
            slot=task_result.slot,
            global_done=completed_works,
            global_total=total_works,
            artist=task.artist_label,
            work_id=task.work_id,
        )

    if concurrency <= 1 or len(tasks) <= 1:
        for task in tasks:
            record_task(
                _download_one_task(
                    task,
                    slot=0,
                    pixiv_cookie=pixiv_cookie,
                    allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
                    overwrite=overwrite,
                    delay_seconds=delay_seconds,
                    separate_restricted=separate_restricted,
                    progress_callback=progress_callback,
                )
            )
    else:
        # A pool of slot ids (0..concurrency-1) gives each in-flight task a stable
        # progress lane: a worker grabs a free slot, holds it for the whole task,
        # and returns it on finish. The UI shows one bar per slot.
        slot_pool: "queue.Queue[int]" = queue.Queue()
        for slot_id in range(concurrency):
            slot_pool.put(slot_id)

        def run_with_slot(task: _DownloadTask) -> _DownloadTaskResult:
            slot = slot_pool.get()
            try:
                return _download_one_task(
                    task,
                    slot=slot,
                    pixiv_cookie=pixiv_cookie,
                    allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
                    overwrite=overwrite,
                    delay_seconds=delay_seconds,
                    separate_restricted=separate_restricted,
                    progress_callback=progress_callback,
                )
            finally:
                slot_pool.put(slot)

        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = [executor.submit(run_with_slot, task) for task in tasks]
            for future in as_completed(futures):
                record_task(future.result())

    for artist in downloadable_artists:
        completed_work_ids = completed_by_artist.get(artist.id) or set()
        if completed_work_ids:
            save_path = Path(artist.save_paths[0]) if artist.save_paths else None
            if not save_path and output_root:
                save_path = output_root / f"{artist.name or 'artist'}-{artist.id}"
            artist.merge(work_ids=completed_work_ids, save_path=save_path)
        if artist.id in downloaded_artists:
            result.artists += 1

    db.save()
    return result
