"""A lightweight per-image catalog for the Image Library browser.

Unlike the similar-image index (which perceptual-hashes every file), this only
records cheap, header-readable facts (dimensions) plus name-derived metadata
(Pixiv work id / page, format) and the resolved artist id. It is persisted to
``library_index.json`` and rebuilt by the ``library.scan`` GUI command, reusing
cached dimensions for files whose size+mtime are unchanged and carrying forward
any per-image tags the user has set.
"""

from __future__ import annotations

import json
import os
import re
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..database import ArtistDatabase
from ..events import PROGRESS_LIBRARY_DONE, PROGRESS_LIBRARY_FILES, PROGRESS_LIBRARY_START
from ..paths import DEFAULT_LIBRARY_INDEX, write_json_atomic
from ..scanner import WORK_ID_PATTERN
from ..similar._shared import ProgressCallback, emit
from ..similar.filewalk import iter_image_files
from ..similar.grouping import PIXIV_PAGE_NAME_PATTERN


def _pillow():
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = None
    warnings.simplefilter("ignore", Image.DecompressionBombWarning)
    return Image


def read_image_size(path: Path) -> tuple[int, int]:
    """Read pixel dimensions from the image header without decoding the pixels."""
    Image = _pillow()
    with Image.open(path) as image:
        return int(image.width), int(image.height)


# Camera / screenshot timestamps (e.g. 20230912_165005, 2023-09-12, IMG_20230912_165005)
# are NOT Pixiv work ids — mining a "PID" out of them mis-attributes the artist.
# Anchored at the start (after an optional alpha prefix) so a date *inside* a real
# title (e.g. "12345678-2023 spring") doesn't suppress a genuine id.
_TIMESTAMP_NAME = re.compile(
    r"^(?:[A-Za-z][A-Za-z _-]*?)?"  # optional prefix: IMG_, Screenshot_, VID_, ...
    r"(?:"
    r"(?:19|20)\d{6}[ ._-]\d{6}"  # YYYYMMDD_HHMMSS / YYYYMMDD-HHMMSS
    r"|(?:19|20)\d{2}[-_.](?:0[1-9]|1[0-2])[-_.](?:0[1-9]|[12]\d|3[01])"  # YYYY-MM-DD
    r")"
)


def parse_pixiv_name(path: Path) -> tuple[str, int | None]:
    """Extract (pid, page) from a filename. Prefers the explicit ``{pid}_p{page}``
    Pixiv form, then falls back to the first standalone work-id-looking number.
    Date/time filenames (camera, screenshots) return no pid."""
    stem = path.stem
    if _TIMESTAMP_NAME.match(stem):
        return "", None
    page_match = PIXIV_PAGE_NAME_PATTERN.search(stem)
    if page_match:
        return page_match.group("pid"), int(page_match.group("page"))
    work_match = WORK_ID_PATTERN.search(stem)
    if work_match:
        return work_match.group("id"), None
    return "", None


def _clean_tags(tags: Any) -> list[str]:
    return sorted({str(tag).strip() for tag in tags or [] if str(tag).strip()})


def _clean_pixiv_tags(tags: Any) -> list[dict[str, str]]:
    """Normalize the auto-fetched Pixiv tags to a deduped list of
    ``{"tag", "translation"}`` (original order preserved)."""
    cleaned: list[dict[str, str]] = []
    seen: set[str] = set()
    for entry in tags or []:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("tag") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        cleaned.append({"tag": name, "translation": str(entry.get("translation") or "").strip()})
    return cleaned


@dataclass
class LibraryImage:
    path: str
    size_bytes: int
    mtime_ns: int
    width: int
    height: int
    format: str
    pid: str = ""
    page: int | None = None
    artist_id: str = ""
    folder: str = ""
    tags: list[str] = field(default_factory=list)
    pixiv_tags: list[dict[str, str]] = field(default_factory=list)

    @classmethod
    def from_json(cls, raw: dict[str, Any]) -> "LibraryImage":
        page = raw.get("page")
        return cls(
            path=str(raw["path"]),
            size_bytes=int(raw.get("size_bytes") or 0),
            mtime_ns=int(raw.get("mtime_ns") or 0),
            width=int(raw.get("width") or 0),
            height=int(raw.get("height") or 0),
            format=str(raw.get("format") or ""),
            pid=str(raw.get("pid") or ""),
            page=int(page) if page is not None else None,
            artist_id=str(raw.get("artist_id") or ""),
            folder=str(raw.get("folder") or ""),
            tags=_clean_tags(raw.get("tags")),
            pixiv_tags=_clean_pixiv_tags(raw.get("pixiv_tags")),
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "size_bytes": self.size_bytes,
            "mtime_ns": self.mtime_ns,
            "width": self.width,
            "height": self.height,
            "format": self.format,
            "pid": self.pid,
            "page": self.page,
            "artist_id": self.artist_id,
            "folder": self.folder,
            "tags": _clean_tags(self.tags),
            "pixiv_tags": _clean_pixiv_tags(self.pixiv_tags),
        }

    @property
    def resolution(self) -> str:
        return f"{self.width}x{self.height}" if self.width and self.height else ""

    @property
    def orientation(self) -> str:
        if not self.width or not self.height:
            return "unknown"
        if self.width > self.height:
            return "landscape"
        if self.width < self.height:
            return "portrait"
        return "square"


@dataclass
class CatalogSummary:
    files_seen: int = 0
    indexed: int = 0
    reused: int = 0
    changed: int = 0
    error_count: int = 0
    errors: list[str] = field(default_factory=list)


def build_pid_to_artist(db: ArtistDatabase) -> dict[str, str]:
    """Map every known work id to the artist that owns it (first wins)."""
    mapping: dict[str, str] = {}
    for artist in db.artists.values():
        for work_id in artist.work_ids:
            mapping.setdefault(str(work_id), artist.id)
    return mapping


def build_save_path_index(db: ArtistDatabase) -> dict[str, str]:
    """Map normalized, resolved save-path -> artist id, so an image can be
    attributed to the artist whose folder it lives under (first wins)."""
    index: dict[str, str] = {}
    for artist in db.artists.values():
        for save_path in artist.save_paths:
            try:
                key = os.path.normcase(str(Path(save_path).expanduser().resolve()))
            except OSError:
                continue
            index.setdefault(key, artist.id)
    return index


def resolve_folder_artist(folder: str, save_index: dict[str, str]) -> str:
    """Return the artist id whose save folder contains ``folder`` (checking the
    folder and up to a few parent levels), or "" when none matches."""
    if not save_index or not folder:
        return ""
    try:
        path = Path(folder).expanduser().resolve()
    except OSError:
        return ""
    for ancestor in (path, *path.parents)[:8]:
        artist_id = save_index.get(os.path.normcase(str(ancestor)))
        if artist_id:
            return artist_id
    return ""


def _progress_step(total: int, requested_interval: int) -> int:
    """Throttle to roughly ≤200 progress emissions for very large libraries."""
    if requested_interval <= 0 or total <= 0:
        return 0
    return max(1, min(requested_interval, max(1, total // 200)))


def build_catalog(
    roots: list[Path],
    exclude_roots: list[Path] | None = None,
    *,
    pid_to_artist: dict[str, str] | None = None,
    old_catalog: dict[str, LibraryImage] | None = None,
    progress_callback: ProgressCallback | None = None,
    progress_interval: int = 100,
    max_errors: int = 200,
) -> tuple[list[LibraryImage], CatalogSummary]:
    pid_map = pid_to_artist or {}
    old = old_catalog or {}
    images: list[LibraryImage] = []
    summary = CatalogSummary()
    paths_list = list(iter_image_files(roots, exclude_roots))
    total = len(paths_list)
    step = _progress_step(total, progress_interval)
    emit(progress_callback, PROGRESS_LIBRARY_START, total_files=total)

    for path in paths_list:
        summary.files_seen += 1
        resolved = str(path.resolve())
        try:
            stat = path.stat()
            prev = old.get(resolved)
            if prev and prev.width and prev.height and prev.size_bytes == stat.st_size and prev.mtime_ns == stat.st_mtime_ns:
                width, height = prev.width, prev.height
                summary.reused += 1
            else:
                width, height = read_image_size(path)
                summary.changed += 1
            pid, page = parse_pixiv_name(path)
            images.append(
                LibraryImage(
                    path=resolved,
                    size_bytes=stat.st_size,
                    mtime_ns=stat.st_mtime_ns,
                    width=width,
                    height=height,
                    format=path.suffix.lower().lstrip("."),
                    pid=pid,
                    page=page,
                    artist_id=pid_map.get(pid, "") if pid else "",
                    folder=str(path.parent),
                    tags=list(prev.tags) if prev else [],
                    pixiv_tags=[dict(item) for item in prev.pixiv_tags] if prev else [],
                )
            )
        except Exception as exc:  # noqa: BLE001 -- per-file error boundary, broad on purpose
            summary.error_count += 1
            if len(summary.errors) < max_errors:
                summary.errors.append(f"{path}: {exc}")
        if progress_callback and step and (summary.files_seen % step == 0 or summary.files_seen == total):
            emit(
                progress_callback,
                PROGRESS_LIBRARY_FILES,
                files=summary.files_seen,
                total_files=total,
                indexed=len(images),
                reused=summary.reused,
                changed=summary.changed,
                errors=summary.error_count,
            )

    summary.indexed = len(images)
    emit(
        progress_callback,
        PROGRESS_LIBRARY_DONE,
        files=summary.files_seen,
        total_files=total,
        indexed=summary.indexed,
        errors=summary.error_count,
    )
    return images, summary


def load_library_index(path: Path = DEFAULT_LIBRARY_INDEX) -> dict[str, LibraryImage]:
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    entries = raw.get("entries") or {}
    result: dict[str, LibraryImage] = {}
    for item_path, item in entries.items():
        if not isinstance(item, dict):
            continue
        try:
            image = LibraryImage.from_json({**item, "path": str(item.get("path") or item_path)})
        except (KeyError, TypeError, ValueError):
            continue
        result[image.path] = image
    return result


def save_library_index(images: Any, path: Path = DEFAULT_LIBRARY_INDEX) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(images, key=lambda image: image.path.lower())
    write_json_atomic(path, {"version": 1, "entries": {image.path: image.to_json() for image in ordered}})
