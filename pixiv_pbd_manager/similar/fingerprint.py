"""Per-image fingerprint: SHA-256 + perceptual hashes (pHash, dHash).

``imagehash`` is the preferred backend (matches reference values from other
deduplicators). If it isn't installed we fall back to small in-house
average/difference hashes that produce comparable-but-not-identical values —
good enough that ``hamming_hex`` distances stay well-correlated.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any


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


def ensure_image_dependencies() -> None:
    if Image is None:
        raise RuntimeError("Pillow is required for similar image detection. Run: pip install -e .")


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
    """Decide whether a cached fingerprint can stand in for a fresh hash.

    We use stat metadata only: a file with unchanged size+mtime is treated as
    unchanged content. Hashing every image on every scan would be prohibitive
    for libraries with tens of thousands of files.
    """
    try:
        stat = path.stat()
    except OSError:
        return False
    return entry.size_bytes == stat.st_size and entry.mtime_ns == stat.st_mtime_ns
