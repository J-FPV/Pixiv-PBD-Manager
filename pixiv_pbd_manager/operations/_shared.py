"""Helpers shared by both the scan and update-check operation modules.

These are intentionally module-internal (``_shared``): callers outside the
``operations`` package should import the public names from
``pixiv_pbd_manager.operations`` instead.
"""

from __future__ import annotations

from collections.abc import Callable
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


def collect_local_work_ids(save_paths: list[str], *, recursive: bool = True) -> set[str]:
    """Scan an artist's saved folder(s) and collect work ids on disk."""
    ids: set[str] = set()
    for raw in save_paths:
        folder = Path(raw)
        if not folder.exists():
            continue
        paths = iter_media_files(folder) if recursive else _iter_direct_media_files(folder)
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
    summary.unmatched_examples = [
        path for path in summary.unmatched_examples if not is_under_known_save_root(path.parent, save_roots)
    ]
