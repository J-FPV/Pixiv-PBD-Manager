"""Helpers shared by both the scan and update-check operation modules.

These are intentionally module-internal (``_shared``): callers outside the
``operations`` package should import the public names from
``pixiv_pbd_manager.operations`` instead.
"""

from __future__ import annotations

from collections.abc import Callable
import os
from pathlib import Path

from ..database import ArtistDatabase
from ..models import ArtistRecord
from ..scanner import MEDIA_SUFFIXES, ScanSummary, extract_work_ids, is_relative_to, iter_media_files


ProgressCallback = Callable[[str, dict[str, object]], None]


def emit(progress_callback: ProgressCallback | None, key: str, **kwargs: object) -> None:
    if progress_callback:
        progress_callback(key, kwargs)


def _iter_direct_media_files(folder: Path):
    for path in folder.iterdir():
        if path.is_file() and path.suffix.lower() in MEDIA_SUFFIXES:
            yield path


def collect_local_work_ids(
    save_paths: list[str],
    *,
    recursive: bool = True,
    max_depth: int | None = None,
) -> set[str]:
    """Scan an artist's saved folder(s) and collect work ids on disk.

    ``max_depth`` (when provided) wins over ``recursive``: ``max_depth=0``
    means only files directly in each save_path, ``max_depth=N`` recurses
    ``N`` levels deep, ``None`` is unlimited. The boolean ``recursive`` flag
    stays for backwards compat (True ⇒ unlimited, False ⇒ depth 0).
    """
    ids: set[str] = set()
    if max_depth is None:
        effective_depth: int | None = None if recursive else 0
    else:
        effective_depth = max_depth
    for raw in save_paths:
        folder = Path(raw)
        if not folder.exists():
            continue
        if effective_depth == 0:
            paths = _iter_direct_media_files(folder)
        else:
            paths = iter_media_files(folder, max_depth=effective_depth)
        for path in paths:
            ids.update(extract_work_ids(path))
    return ids


def artist_save_roots(artist: ArtistRecord) -> list[Path]:
    return [Path(raw).expanduser().resolve() for raw in artist.save_paths if str(raw).strip()]


def known_save_roots(db: ArtistDatabase) -> list[Path]:
    roots: list[Path] = []
    for artist in db.artists.values():
        roots.extend(artist_save_roots(artist))
    return roots


def build_artist_save_path_index(db: ArtistDatabase) -> dict[str, ArtistRecord | None]:
    """Build an exact save-path index; ``None`` marks ambiguous ownership."""
    owners: dict[str, dict[str, ArtistRecord]] = {}
    for artist in db.artists.values():
        for root in artist_save_roots(artist):
            owners.setdefault(os.path.normcase(str(root)), {})[artist.id] = artist
    return {
        path: next(iter(artists.values())) if len(artists) == 1 else None
        for path, artists in owners.items()
    }


def build_artist_work_id_index(db: ArtistDatabase) -> dict[str, ArtistRecord | None]:
    """Build a work-id owner index; ``None`` marks ambiguous ownership."""
    owners: dict[str, dict[str, ArtistRecord]] = {}
    for artist in db.artists.values():
        for work_id in artist.work_ids:
            owners.setdefault(str(work_id), {})[artist.id] = artist
    return {
        work_id: next(iter(artists.values())) if len(artists) == 1 else None
        for work_id, artists in owners.items()
    }


def find_artist_by_save_path(
    save_path_index: dict[str, ArtistRecord | None],
    path: Path,
) -> ArtistRecord | None:
    """Return the nearest indexed save-path owner, stopping on ambiguity."""
    resolved = path.expanduser().resolve()
    for ancestor in (resolved, *resolved.parents):
        key = os.path.normcase(str(ancestor))
        if key in save_path_index:
            return save_path_index[key]
    return None


def find_artist_by_work_ids(
    work_id_index: dict[str, ArtistRecord | None],
    work_ids: set[str] | frozenset[str],
) -> ArtistRecord | None:
    """Return the unique known owner for any of ``work_ids``.

    If different ids point to different artists, or any matched id is already
    ambiguous, decline the match. This keeps offline PID attribution conservative.
    """
    matched_records: list[ArtistRecord] = []
    matched_ids: set[str] = set()
    for work_id in work_ids:
        if work_id not in work_id_index:
            continue
        match = work_id_index[work_id]
        if match is None:
            return None
        matched_records.append(match)
        matched_ids.add(match.id)
    if len(matched_ids) != 1:
        return None
    return matched_records[0]


def is_under_known_save_root(path: Path, save_roots: list[Path]) -> bool:
    resolved = path.expanduser().resolve()
    return any(resolved == root or is_relative_to(resolved, root) for root in save_roots)


def filter_assigned_unmatched_folders(summary: ScanSummary, db: ArtistDatabase) -> None:
    """Drop unmatched folders that already live under some artist's save_path.

    Mutates ``summary`` in place. Called before either the merge-write path or
    the dry-run-preview path consumes ``summary.unmatched_folders``, so the GUI
    never asks the user to re-attribute a folder that was already attributed.
    """
    save_roots = known_save_roots(db)
    if not save_roots:
        return
    summary.unmatched_folders = {
        folder: count
        for folder, count in summary.unmatched_folders.items()
        if not is_under_known_save_root(Path(folder), save_roots)
    }
    # Keep the PID-resolution side tables in lockstep so a folder that's already
    # attributed isn't re-resolved online.
    kept = summary.unmatched_folders.keys()
    summary.unmatched_folder_work_ids = {
        folder: work_ids for folder, work_ids in summary.unmatched_folder_work_ids.items() if folder in kept
    }
    summary.unmatched_folder_roots = {
        folder: root for folder, root in summary.unmatched_folder_roots.items() if folder in kept
    }
    summary.unmatched_examples = [
        path for path in summary.unmatched_examples if not is_under_known_save_root(path.parent, save_roots)
    ]
