from __future__ import annotations

import csv
import hashlib
import json
import os
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .scanner import is_excluded_path, normalize_exclude_roots


DEFAULT_IMAGE_INDEX = Path(".pixiv-pbd-manager") / "image_index.json"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}
LIKELY_LIMITS = (6, 10)
POSSIBLE_LIMITS = (10, 14)

ProgressCallback = Callable[[str, dict[str, object]], None]

try:
    from PIL import Image
except ImportError:  # pragma: no cover - dependency message path
    Image = None  # type: ignore[assignment]

try:
    import imagehash
except ImportError:  # pragma: no cover - fallback is covered instead
    imagehash = None  # type: ignore[assignment]


@dataclass
class ImageFingerprint:
    path: str
    size_bytes: int
    mtime_ns: int
    width: int
    height: int
    sha256: str
    phash: str
    dhash: str

    @classmethod
    def from_json(cls, raw: dict[str, Any]) -> "ImageFingerprint":
        return cls(
            path=str(raw["path"]),
            size_bytes=int(raw["size_bytes"]),
            mtime_ns=int(raw["mtime_ns"]),
            width=int(raw.get("width") or 0),
            height=int(raw.get("height") or 0),
            sha256=str(raw["sha256"]),
            phash=str(raw["phash"]),
            dhash=str(raw["dhash"]),
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "size_bytes": self.size_bytes,
            "mtime_ns": self.mtime_ns,
            "width": self.width,
            "height": self.height,
            "sha256": self.sha256,
            "phash": self.phash,
            "dhash": self.dhash,
        }

    @property
    def resolution(self) -> str:
        return f"{self.width}x{self.height}" if self.width and self.height else ""


@dataclass(frozen=True)
class SimilarPair:
    left: str
    right: str
    kind: str
    phash_distance: int
    dhash_distance: int


@dataclass
class SimilarGroup:
    id: int
    kind: str
    entries: list[ImageFingerprint] = field(default_factory=list)
    best_phash_distance: int = 0
    best_dhash_distance: int = 0


@dataclass
class SimilarImageResult:
    roots: list[str]
    index_path: Path
    files_seen: int = 0
    indexed: int = 0
    reused: int = 0
    changed: int = 0
    error_count: int = 0
    errors: list[str] = field(default_factory=list)
    groups: list[SimilarGroup] = field(default_factory=list)


def emit(progress_callback: ProgressCallback | None, key: str, **kwargs: object) -> None:
    if progress_callback:
        progress_callback(key, kwargs)


def ensure_image_dependencies() -> None:
    if Image is None:
        raise RuntimeError("Pillow is required for similar image detection. Run: pip install -e .")


def record_error(result: SimilarImageResult, message: str, *, max_errors: int) -> None:
    result.error_count += 1
    if len(result.errors) < max_errors:
        result.errors.append(message)


def iter_image_files(roots: list[Path], exclude_roots: list[Path] | None = None):
    excludes = normalize_exclude_roots(exclude_roots)
    for root in roots:
        root = root.expanduser().resolve()
        if root.is_file():
            if not is_excluded_path(root, excludes) and root.suffix.lower() in IMAGE_SUFFIXES:
                yield root
            continue

        for current_dir, dirnames, filenames in os.walk(root):
            current_path = Path(current_dir)
            if is_excluded_path(current_path, excludes):
                dirnames[:] = []
                continue

            dirnames[:] = [
                dirname for dirname in dirnames if not is_excluded_path(current_path / dirname, excludes)
            ]

            for filename in filenames:
                path = current_path / filename
                if path.suffix.lower() in IMAGE_SUFFIXES:
                    yield path


def load_image_index(path: Path = DEFAULT_IMAGE_INDEX) -> dict[str, ImageFingerprint]:
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    entries = raw.get("entries") or {}
    result: dict[str, ImageFingerprint] = {}
    for item_path, item in entries.items():
        try:
            fingerprint = ImageFingerprint.from_json({**item, "path": str(item.get("path") or item_path)})
        except (KeyError, TypeError, ValueError):
            continue
        result[fingerprint.path] = fingerprint
    return result


def save_image_index(entries: list[ImageFingerprint], path: Path = DEFAULT_IMAGE_INDEX) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "entries": {entry.path: entry.to_json() for entry in sorted(entries, key=lambda item: item.path.lower())},
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _hex_from_bits(bits: list[bool]) -> str:
    value = 0
    for bit in bits:
        value = (value << 1) | int(bool(bit))
    width = max(1, (len(bits) + 3) // 4)
    return f"{value:0{width}x}"


def _fallback_average_hash(image) -> str:
    small = image.convert("L").resize((8, 8))
    pixels = list(small.getdata())
    average = sum(pixels) / len(pixels)
    return _hex_from_bits([pixel >= average for pixel in pixels])


def _fallback_difference_hash(image) -> str:
    small = image.convert("L").resize((9, 8))
    pixels = list(small.getdata())
    bits: list[bool] = []
    for y in range(8):
        row = pixels[y * 9 : (y + 1) * 9]
        bits.extend(row[x] > row[x + 1] for x in range(8))
    return _hex_from_bits(bits)


def image_hashes(path: Path) -> tuple[int, int, str, str]:
    ensure_image_dependencies()
    with Image.open(path) as image:
        try:
            image.seek(0)
        except EOFError:
            pass
        image.load()
        width, height = image.size
        frame = image.convert("RGB")
    if imagehash is not None:
        return width, height, str(imagehash.phash(frame)), str(imagehash.dhash(frame))
    return width, height, _fallback_average_hash(frame), _fallback_difference_hash(frame)


def fingerprint_image(path: Path) -> ImageFingerprint:
    stat = path.stat()
    width, height, phash, dhash = image_hashes(path)
    return ImageFingerprint(
        path=str(path.resolve()),
        size_bytes=stat.st_size,
        mtime_ns=stat.st_mtime_ns,
        width=width,
        height=height,
        sha256=sha256_file(path),
        phash=phash,
        dhash=dhash,
    )


def is_reusable(entry: ImageFingerprint, path: Path) -> bool:
    try:
        stat = path.stat()
    except OSError:
        return False
    return entry.size_bytes == stat.st_size and entry.mtime_ns == stat.st_mtime_ns


def hamming_hex(left: str, right: str) -> int:
    return popcount(int(left, 16) ^ int(right, 16))


def popcount(value: int) -> int:
    return bin(value).count("1")


class UnionFind:
    def __init__(self, size: int) -> None:
        self.parent = list(range(size))

    def find(self, value: int) -> int:
        while self.parent[value] != value:
            self.parent[value] = self.parent[self.parent[value]]
            value = self.parent[value]
        return value

    def union(self, left: int, right: int) -> None:
        root_left = self.find(left)
        root_right = self.find(right)
        if root_left != root_right:
            self.parent[root_right] = root_left


class BKTree:
    def __init__(self) -> None:
        self.root: dict[str, Any] | None = None

    def add(self, value: int, index: int) -> None:
        node = {"value": value, "indices": [index], "children": {}}
        if self.root is None:
            self.root = node
            return
        current = self.root
        while True:
            distance = popcount(current["value"] ^ value)
            if distance == 0:
                current["indices"].append(index)
                return
            child = current["children"].get(distance)
            if child is None:
                current["children"][distance] = node
                return
            current = child

    def query(self, value: int, max_distance: int) -> list[int]:
        if self.root is None:
            return []
        found: list[int] = []
        stack = [self.root]
        while stack:
            node = stack.pop()
            distance = popcount(node["value"] ^ value)
            if distance <= max_distance:
                found.extend(node["indices"])
            low = distance - max_distance
            high = distance + max_distance
            for child_distance, child in node["children"].items():
                if low <= child_distance <= high:
                    stack.append(child)
        return found


def pair_kind(phash_distance: int, dhash_distance: int) -> str | None:
    if phash_distance <= LIKELY_LIMITS[0] and dhash_distance <= LIKELY_LIMITS[1]:
        return "likely"
    if phash_distance <= POSSIBLE_LIMITS[0] and dhash_distance <= POSSIBLE_LIMITS[1]:
        return "possible"
    return None


def build_similar_groups(entries: list[ImageFingerprint], *, threshold: str = "likely") -> list[SimilarGroup]:
    if len(entries) < 2:
        return []

    include_possible = threshold == "possible"
    max_phash_distance = POSSIBLE_LIMITS[0] if include_possible else LIKELY_LIMITS[0]
    union_find = UnionFind(len(entries))
    pairs: list[SimilarPair] = []

    sha_groups: dict[str, list[int]] = defaultdict(list)
    for index, entry in enumerate(entries):
        sha_groups[entry.sha256].append(index)
    for indices in sha_groups.values():
        if len(indices) < 2:
            continue
        first = indices[0]
        for index in indices[1:]:
            union_find.union(first, index)
            pairs.append(SimilarPair(entries[first].path, entries[index].path, "exact", 0, 0))

    tree = BKTree()
    for index, entry in enumerate(entries):
        phash_value = int(entry.phash, 16)
        for candidate_index in tree.query(phash_value, max_phash_distance):
            candidate = entries[candidate_index]
            if candidate.sha256 == entry.sha256:
                continue
            phash_distance = hamming_hex(candidate.phash, entry.phash)
            dhash_distance = hamming_hex(candidate.dhash, entry.dhash)
            kind = pair_kind(phash_distance, dhash_distance)
            if kind == "possible" and not include_possible:
                continue
            if kind:
                union_find.union(candidate_index, index)
                pairs.append(SimilarPair(candidate.path, entry.path, kind, phash_distance, dhash_distance))
        tree.add(phash_value, index)

    grouped_indices: dict[int, list[int]] = defaultdict(list)
    for index in range(len(entries)):
        grouped_indices[union_find.find(index)].append(index)

    pair_by_root: dict[int, list[SimilarPair]] = defaultdict(list)
    path_to_index = {entry.path: index for index, entry in enumerate(entries)}
    for pair in pairs:
        left_root = union_find.find(path_to_index[pair.left])
        pair_by_root[left_root].append(pair)

    groups: list[SimilarGroup] = []
    priority = {"exact": 0, "likely": 1, "possible": 2}
    for indices in grouped_indices.values():
        if len(indices) < 2:
            continue
        root = union_find.find(indices[0])
        group_pairs = pair_by_root.get(root, [])
        best_kind = min((pair.kind for pair in group_pairs), key=lambda value: priority[value], default="possible")
        visual_pairs = [pair for pair in group_pairs if pair.kind != "exact"]
        best_phash = min((pair.phash_distance for pair in visual_pairs), default=0)
        best_dhash = min((pair.dhash_distance for pair in visual_pairs), default=0)
        groups.append(
            SimilarGroup(
                id=len(groups) + 1,
                kind=best_kind,
                entries=sorted((entries[index] for index in indices), key=lambda item: item.path.lower()),
                best_phash_distance=best_phash,
                best_dhash_distance=best_dhash,
            )
        )
    return sorted(groups, key=lambda group: (priority[group.kind], -len(group.entries), group.id))


def find_similar_images(
    roots: list[Path],
    *,
    index_path: Path = DEFAULT_IMAGE_INDEX,
    exclude_roots: list[Path] | None = None,
    threshold: str = "likely",
    max_errors: int = 200,
    progress_callback: ProgressCallback | None = None,
) -> SimilarImageResult:
    if threshold not in {"likely", "possible"}:
        raise ValueError("threshold must be 'likely' or 'possible'")
    ensure_image_dependencies()
    old_index = load_image_index(index_path)
    entries: list[ImageFingerprint] = []
    result = SimilarImageResult(roots=[str(Path(root).resolve()) for root in roots], index_path=index_path)
    emit(progress_callback, "progress_similar_start", roots=len(roots))

    for path in iter_image_files(roots, exclude_roots):
        result.files_seen += 1
        resolved = str(path.resolve())
        old_entry = old_index.get(resolved)
        if old_entry and is_reusable(old_entry, path):
            entries.append(old_entry)
            result.reused += 1
        else:
            try:
                entries.append(fingerprint_image(path))
                result.changed += 1
            except Exception as exc:  # noqa: BLE001
                record_error(result, f"{path}: {exc}", max_errors=max_errors)
        if progress_callback and result.files_seen % 500 == 0:
            emit(
                progress_callback,
                "progress_similar_files",
                files=result.files_seen,
                indexed=len(entries),
                reused=result.reused,
                errors=result.error_count,
            )

    result.indexed = len(entries)
    result.groups = build_similar_groups(entries, threshold=threshold)
    save_image_index(entries, index_path)
    emit(
        progress_callback,
        "progress_similar_done",
        files=result.files_seen,
        indexed=result.indexed,
        groups=len(result.groups),
        errors=result.error_count,
    )
    return result


def write_similar_report(result: SimilarImageResult, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "group",
                "kind",
                "count",
                "path",
                "width",
                "height",
                "size_bytes",
                "sha256",
                "phash",
                "dhash",
            ]
        )
        for group in result.groups:
            for entry in group.entries:
                writer.writerow(
                    [
                        group.id,
                        group.kind,
                        len(group.entries),
                        entry.path,
                        entry.width,
                        entry.height,
                        entry.size_bytes,
                        entry.sha256,
                        entry.phash,
                        entry.dhash,
                    ]
                )
