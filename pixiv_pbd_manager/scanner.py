from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
import hashlib
import os
from collections.abc import Callable


MEDIA_SUFFIXES = {
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".avif",
    ".bmp",
    ".webm",
    ".zip",
    ".txt",
    ".epub",
}

FOLDER_ARTIST_PATTERNS = [
    re.compile(r"^(?P<name>.+?)-(?P<id>\d{3,12})$"),
    re.compile(r"^(?P<name>.+?)\s*\((?P<id>\d{3,12})\)$"),
    re.compile(r"^\[(?P<id>\d{3,12})\]\s*(?P<name>.+)$"),
    re.compile(r"^(?P<id>\d{3,12})[_ -]+(?P<name>.+)$"),
]

# Numeric threshold below which a folder-name match is rejected by default.
# Pixiv user IDs in this range exist (very old 2007 accounts) but are vastly
# outnumbered by false positives — most notably date prefixes ``2020-07-01-X``
# matching the leading-digits pattern with id=2020. The frontend exposes a
# ``recognize_low_pids`` toggle that lifts this filter for users who actually
# need the old-account behaviour.
LOW_PID_THRESHOLD = 3000

NAME_ONLY_PIXIV_FOLDER_PATTERNS = [
    re.compile(r"^(?:illus[-_ ])?(?P<name>.+?)'s illustrations[／/]manga(?: - pixiv)?$", re.I),
    re.compile(r"^(?:illus[-_ ])?(?P<name>.+?)'s illustrations(?: - pixiv|-)?$", re.I),
    re.compile(r"^(?:illus[-_ ])?(?P<name>.+?) - pixiv$", re.I),
    re.compile(r"^illus[-_ ](?P<name>[^\\/\-_]+)(?:[-_ ].*)?$", re.I),
]

KEYWORD_ARTIST_PATTERNS = [
    re.compile(r"(?:user|uid|member|artist)[_-]?id[= _-]*(?P<id>\d{3,12})(?:[ _-]+(?P<name>[^\\/]+))?", re.I),
    re.compile(r"(?:user|uid|member|artist)[= _-]*(?P<id>\d{3,12})(?:[ _-]+(?P<name>[^\\/]+))?", re.I),
]

WORK_ID_PATTERN = re.compile(r"(?<!\d)(?P<id>\d{6,12})(?:[_-]p\d+|[^\d]|$)", re.I)


@dataclass
class ScanHit:
    artist_id: str
    artist_name: str | None
    source: str
    root: Path
    folder: Path
    path: Path
    work_ids: set[str] = field(default_factory=set)


@dataclass
class NameOnlyArtistHit:
    artist_key: str
    artist_name: str
    source: str
    root: Path
    folder: Path
    path: Path
    work_ids: set[str] = field(default_factory=set)


@dataclass
class ScanSummary:
    files_seen: int = 0
    files_matched: int = 0
    excluded_dirs: int = 0
    artists: dict[str, ScanHit] = field(default_factory=dict)
    name_only_artists: dict[str, NameOnlyArtistHit] = field(default_factory=dict)
    unmatched_examples: list[Path] = field(default_factory=list)
    # Folder path -> number of unidentified media files under it. A folder is
    # "unmatched" when its files hit neither an artist-id pattern nor a Pixiv
    # name-only folder pattern.
    unmatched_folders: dict[str, int] = field(default_factory=dict)

    def add_hit(self, hit: ScanHit) -> None:
        existing = self.artists.get(hit.artist_id)
        if not existing:
            self.artists[hit.artist_id] = hit
            self.files_matched += 1
            return
        if not existing.artist_name and hit.artist_name:
            existing.artist_name = hit.artist_name
        existing.work_ids.update(hit.work_ids)
        self.files_matched += 1

    def add_name_only_hit(self, hit: NameOnlyArtistHit) -> None:
        existing = self.name_only_artists.get(hit.artist_key)
        if not existing:
            self.name_only_artists[hit.artist_key] = hit
            return
        existing.work_ids.update(hit.work_ids)


def normalize_exclude_roots(exclude_roots: list[Path] | None = None) -> list[Path]:
    return [path.expanduser().resolve() for path in (exclude_roots or [])]


def is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def is_excluded_path(path: Path, exclude_roots: list[Path]) -> bool:
    resolved = path.expanduser().resolve()
    return any(resolved == exclude or is_relative_to(resolved, exclude) for exclude in exclude_roots)


def iter_media_files(
    root: Path,
    exclude_roots: list[Path] | None = None,
    *,
    max_depth: int | None = None,
):
    """Walk ``root`` for media files. ``max_depth`` limits how deep we recurse:
    ``None`` (default) = unlimited; ``0`` = only files directly in ``root``;
    ``N`` = up to ``N`` directories below ``root``.
    """
    excludes = normalize_exclude_roots(exclude_roots)
    if root.is_file():
        if not is_excluded_path(root, excludes) and root.suffix.lower() in MEDIA_SUFFIXES:
            yield root
        return

    root_str = str(root)
    root_depth = root_str.count(os.sep)

    for current_dir, dirnames, filenames in os.walk(root):
        current_path = Path(current_dir)
        if is_excluded_path(current_path, excludes):
            dirnames[:] = []
            continue

        if max_depth is not None and max_depth >= 0:
            depth = current_dir.count(os.sep) - root_depth
            if depth >= max_depth:
                dirnames[:] = []  # stop descending below the cap

        kept_dirnames = []
        for dirname in dirnames:
            child_dir = current_path / dirname
            if not is_excluded_path(child_dir, excludes):
                kept_dirnames.append(dirname)
        dirnames[:] = kept_dirnames

        for filename in filenames:
            path = current_path / filename
            if path.suffix.lower() in MEDIA_SUFFIXES:
                yield path


def clean_name(name: str | None) -> str | None:
    if not name:
        return None
    value = name.strip(" -_[]")
    return value or None


def normalize_artist_name_from_folder(name: str | None) -> str | None:
    value = clean_name(name)
    if not value:
        return None
    if value.lower().startswith("illus-"):
        value = value[6:].strip(" -_")
    return value or None


def plausible_artist_id(value: str, *, allow_low_pids: bool = False) -> bool:
    if not value.isdigit():
        return False
    numeric = int(value)
    if not (1 <= numeric <= 999_999_999_999):
        return False
    if not allow_low_pids and numeric < LOW_PID_THRESHOLD:
        return False
    return True


def find_artist_in_text(
    text: str,
    *,
    include_loose_patterns: bool,
    allow_low_pids: bool = False,
) -> tuple[str, str | None, str] | None:
    patterns = KEYWORD_ARTIST_PATTERNS
    if include_loose_patterns:
        patterns = [*FOLDER_ARTIST_PATTERNS, *KEYWORD_ARTIST_PATTERNS]
    for pattern in patterns:
        match = pattern.search(text)
        if not match:
            continue
        artist_id = match.group("id")
        if plausible_artist_id(artist_id, allow_low_pids=allow_low_pids):
            return artist_id, clean_name(match.groupdict().get("name")), pattern.pattern
    return None


def find_name_only_pixiv_artist(text: str) -> tuple[str, str] | None:
    for pattern in NAME_ONLY_PIXIV_FOLDER_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        artist_name = normalize_artist_name_from_folder(match.group("name"))
        if artist_name:
            return artist_name, pattern.pattern
    return None


def extract_work_ids(path: Path) -> set[str]:
    ids: set[str] = set()
    for match in WORK_ID_PATTERN.finditer(path.stem):
        ids.add(match.group("id"))
    return ids


def stable_artist_key(root: Path, folder: Path, name: str) -> str:
    try:
        folder_text = str(folder.relative_to(root))
    except ValueError:
        folder_text = str(folder)
    digest = hashlib.sha1(f"{folder_text}|{name}".encode("utf-8")).hexdigest()[:12]
    return f"name:{digest}"


def identify_artist(path: Path, root: Path, *, allow_low_pids: bool = False) -> ScanHit | None:
    relative_parts = []
    try:
        relative_parts = list(path.relative_to(root).parts)
    except ValueError:
        relative_parts = list(path.parts)

    folder_parts = relative_parts[:-1]
    folder_paths: list[tuple[str, Path]] = []
    current_folder = root
    for part in folder_parts:
        current_folder = current_folder / part
        folder_paths.append((part, current_folder))

    for part, folder_path in reversed(folder_paths):
        found = find_artist_in_text(part, include_loose_patterns=True, allow_low_pids=allow_low_pids)
        if found:
            artist_id, artist_name, pattern = found
            return ScanHit(
                artist_id=artist_id,
                artist_name=artist_name,
                source=f"folder:{pattern}",
                root=root,
                folder=folder_path,
                path=path,
                work_ids=extract_work_ids(path),
            )

    found = find_artist_in_text(path.name, include_loose_patterns=False, allow_low_pids=allow_low_pids)
    if found:
        artist_id, artist_name, pattern = found
        return ScanHit(
            artist_id=artist_id,
            artist_name=artist_name,
            source=f"filename:{pattern}",
            root=root,
            folder=path.parent,
            path=path,
            work_ids=extract_work_ids(path),
        )
    return None


def identify_name_only_artist(path: Path, root: Path) -> NameOnlyArtistHit | None:
    relative_parts = []
    try:
        relative_parts = list(path.relative_to(root).parts)
    except ValueError:
        relative_parts = list(path.parts)

    folder_parts = relative_parts[:-1]
    folder_path = root
    for index, part in enumerate(folder_parts):
        folder_path = folder_path / part
        found = find_name_only_pixiv_artist(part)
        if not found:
            continue
        artist_name, pattern = found
        return NameOnlyArtistHit(
            artist_key=stable_artist_key(root, folder_path, artist_name),
            artist_name=artist_name,
            source=f"folder_name_only:{pattern}",
            root=root,
            folder=folder_path,
            path=path,
            work_ids=extract_work_ids(path),
        )
    return None


def scan_roots(
    roots: list[Path],
    exclude_roots: list[Path] | None = None,
    progress_callback: Callable[[ScanSummary], None] | None = None,
    progress_interval: int = 1000,
    *,
    max_depth: int | None = None,
    allow_low_pids: bool = False,
) -> ScanSummary:
    summary = ScanSummary()
    excludes = normalize_exclude_roots(exclude_roots)
    for root in roots:
        root = root.expanduser().resolve()
        root_excludes = [
            exclude
            for exclude in excludes
            if root == exclude or is_relative_to(exclude, root) or is_relative_to(root, exclude)
        ]
        summary.excluded_dirs += len(root_excludes)
        for path in iter_media_files(root, root_excludes, max_depth=max_depth):
            summary.files_seen += 1
            if progress_callback and progress_interval > 0 and summary.files_seen % progress_interval == 0:
                progress_callback(summary)
            hit = identify_artist(path, root, allow_low_pids=allow_low_pids)
            if hit:
                summary.add_hit(hit)
                continue
            name_only_hit = identify_name_only_artist(path, root)
            if name_only_hit:
                summary.add_name_only_hit(name_only_hit)
            else:
                parent_resolved = path.parent.resolve()
                # The scan root itself is the library starting point, not a
                # folder the user needs to attribute or exclude. Loose files at
                # that top level should not surface the root in the GUI list.
                if parent_resolved != root:
                    folder_text = str(parent_resolved)
                    summary.unmatched_folders[folder_text] = summary.unmatched_folders.get(folder_text, 0) + 1
                if len(summary.unmatched_examples) < 20:
                    summary.unmatched_examples.append(path)
    if progress_callback:
        progress_callback(summary)
    return summary
