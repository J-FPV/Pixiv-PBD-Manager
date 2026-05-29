"""Persistent on-disk index of image fingerprints.

JSON file under DATA_DIR/image_index.json. The runner consults it before
fingerprinting each image so unchanged files reuse their previous hash
rather than re-decoding the pixels.
"""

from __future__ import annotations

import json
from pathlib import Path

from ..paths import DEFAULT_IMAGE_INDEX, write_json_atomic
from .fingerprint import ImageFingerprint


__all__ = ["DEFAULT_IMAGE_INDEX", "load_image_index", "save_image_index"]


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
    write_json_atomic(path, payload)
