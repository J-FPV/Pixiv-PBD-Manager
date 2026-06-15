"""Rebuild artist work-id indexes from files currently present on disk."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
import shutil

from ..database import ArtistDatabase
from ..events import (
    PROGRESS_REBUILD_INDEX_ARTIST,
    PROGRESS_REBUILD_INDEX_DONE,
    PROGRESS_REBUILD_INDEX_START,
)
from ..scanner import (
    extract_work_ids,
    is_excluded_resolved_path,
    iter_media_files,
    normalize_exclude_roots,
    normalize_scan_roots,
)
from ._shared import ProgressCallback, emit


CancelCheck = Callable[[], bool]
PauseWait = Callable[[], None]


@dataclass
class WorkIndexArtistChange:
    artist_id: str
    name: str
    files_seen: int
    old_count: int
    new_count: int
    added_ids: list[str] = field(default_factory=list)
    removed_ids: list[str] = field(default_factory=list)


@dataclass
class WorkIndexRebuildResult:
    artists_total: int = 0
    artists_scanned: int = 0
    artists_skipped: int = 0
    artists_changed: int = 0
    files_seen: int = 0
    old_ids: int = 0
    new_ids: int = 0
    added_ids: int = 0
    removed_ids: int = 0
    pending_ids_cleared: int = 0
    conflicting_ids: list[str] = field(default_factory=list)
    missing_paths: list[str] = field(default_factory=list)
    changes: list[WorkIndexArtistChange] = field(default_factory=list)
    cancelled: bool = False
    applied: bool = False
    db_path: Path | None = None
    backup_path: Path | None = None


def _collect_artist_work_ids(
    db: ArtistDatabase,
    *,
    exclude_roots: list[Path] | None,
    progress_callback: ProgressCallback | None,
    is_cancelled: CancelCheck | None,
    wait_if_paused: PauseWait | None,
) -> tuple[dict[str, set[str]], dict[str, int], set[str], list[str], int, bool]:
    artist_ids = sorted(db.artists, key=lambda value: (len(value), value))
    collected: dict[str, set[str]] = {}
    file_counts: dict[str, int] = {}
    scanned_artists: set[str] = set()
    missing_paths: list[str] = []
    total_files = 0
    excludes = normalize_exclude_roots(exclude_roots)

    emit(progress_callback, PROGRESS_REBUILD_INDEX_START, total=len(artist_ids))
    for index, artist_id in enumerate(artist_ids, 1):
        if wait_if_paused:
            wait_if_paused()
        if is_cancelled and is_cancelled():
            return collected, file_counts, scanned_artists, missing_paths, total_files, True

        artist = db.artists[artist_id]
        existing_roots: list[Path] = []
        for raw_path in artist.save_paths:
            path = Path(raw_path).expanduser().resolve()
            if path.is_dir() and not is_excluded_resolved_path(path, excludes):
                existing_roots.append(path)
            elif not path.exists():
                missing_paths.append(str(path))

        work_ids: set[str] = set()
        files_seen = 0
        if existing_roots:
            scanned_artists.add(artist_id)
            for root in normalize_scan_roots(existing_roots):
                for path in iter_media_files(root, exclude_roots=excludes):
                    if wait_if_paused:
                        wait_if_paused()
                    if is_cancelled and is_cancelled():
                        return collected, file_counts, scanned_artists, missing_paths, total_files, True
                    files_seen += 1
                    work_ids.update(extract_work_ids(path))

        collected[artist_id] = work_ids
        file_counts[artist_id] = files_seen
        total_files += files_seen
        emit(
            progress_callback,
            PROGRESS_REBUILD_INDEX_ARTIST,
            current=index,
            total=len(artist_ids),
            artist=artist.name or artist_id,
            artist_id=artist_id,
            files=files_seen,
            work_ids=len(work_ids),
        )

    return collected, file_counts, scanned_artists, missing_paths, total_files, False


def rebuild_artist_work_index(
    db_path: Path,
    *,
    apply: bool = False,
    exclude_roots: list[Path] | None = None,
    progress_callback: ProgressCallback | None = None,
    is_cancelled: CancelCheck | None = None,
    wait_if_paused: PauseWait | None = None,
) -> WorkIndexRebuildResult:
    """Preview or apply a local-file-derived replacement for every work-id list."""
    db = ArtistDatabase.load(db_path)
    result = WorkIndexRebuildResult(
        artists_total=len(db.artists),
        db_path=db.path.resolve(),
    )
    collected, file_counts, scanned_artists, missing_paths, files_seen, cancelled = _collect_artist_work_ids(
        db,
        exclude_roots=exclude_roots,
        progress_callback=progress_callback,
        is_cancelled=is_cancelled,
        wait_if_paused=wait_if_paused,
    )
    result.artists_scanned = len(scanned_artists)
    result.artists_skipped = result.artists_total - result.artists_scanned
    result.files_seen = files_seen
    result.old_ids = sum(len(db.artists[artist_id].work_ids) for artist_id in scanned_artists)
    result.missing_paths = sorted(set(missing_paths))
    result.cancelled = cancelled
    if cancelled:
        return result

    owners: dict[str, set[str]] = defaultdict(set)
    for artist_id in scanned_artists:
        for work_id in collected.get(artist_id, set()):
            owners[work_id].add(artist_id)
    conflicts = {work_id for work_id, artist_ids in owners.items() if len(artist_ids) > 1}
    result.conflicting_ids = sorted(conflicts, key=lambda value: (len(value), value))

    for artist_id in sorted(scanned_artists, key=lambda value: (len(value), value)):
        artist = db.artists[artist_id]
        old_ids = set(artist.work_ids)
        new_ids = collected.get(artist_id, set()) - conflicts
        added = sorted(new_ids - old_ids, key=lambda value: (len(value), value))
        removed = sorted(old_ids - new_ids, key=lambda value: (len(value), value))
        cleared_pending = set(artist.new_work_ids) & new_ids
        result.pending_ids_cleared += len(cleared_pending)
        if added or removed:
            result.changes.append(
                WorkIndexArtistChange(
                    artist_id=artist_id,
                    name=artist.name or "",
                    files_seen=file_counts.get(artist_id, 0),
                    old_count=len(old_ids),
                    new_count=len(new_ids),
                    added_ids=added,
                    removed_ids=removed,
                )
            )
        if apply:
            artist.work_ids = sorted(new_ids, key=lambda value: (len(value), value))
            artist.new_work_ids = sorted(
                set(artist.new_work_ids) - new_ids,
                key=lambda value: (len(value), value),
            )

    result.artists_changed = len(result.changes)
    result.new_ids = sum(len(collected.get(artist_id, set()) - conflicts) for artist_id in scanned_artists)
    result.added_ids = sum(len(change.added_ids) for change in result.changes)
    result.removed_ids = sum(len(change.removed_ids) for change in result.changes)
    result.applied = apply
    if apply and (result.changes or result.pending_ids_cleared):
        backup_path = db.path.with_name(f"{db.path.name}.before-work-index-rebuild.bak")
        if db.path.exists():
            backup_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(db.path, backup_path)
            result.backup_path = backup_path.resolve()
        db.save()

    emit(
        progress_callback,
        PROGRESS_REBUILD_INDEX_DONE,
        artists=result.artists_scanned,
        changed=result.artists_changed,
        files=result.files_seen,
        added=result.added_ids,
        removed=result.removed_ids,
        pending_cleared=result.pending_ids_cleared,
        conflicts=len(result.conflicting_ids),
    )
    return result
