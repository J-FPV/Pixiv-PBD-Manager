"""Walk filesystem trees and yield candidate image paths."""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

from ..scanner import is_excluded_path, normalize_exclude_roots, normalize_scan_roots


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}


def iter_image_files(roots: list[Path], exclude_roots: list[Path] | None = None) -> Iterator[Path]:
    excludes = normalize_exclude_roots(exclude_roots)
    for root in normalize_scan_roots(roots):
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
