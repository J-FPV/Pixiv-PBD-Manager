"""Top-level orchestration for the similar-image scan + CSV report."""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from pathlib import Path

from ..events import (
    PROGRESS_SIMILAR_DONE,
    PROGRESS_SIMILAR_FILE_START,
    PROGRESS_SIMILAR_FILES,
    PROGRESS_SIMILAR_INDEX_SAVED,
    PROGRESS_SIMILAR_START,
)
from ..paths import DEFAULT_IMAGE_INDEX
from ._shared import ProgressCallback, emit
from .filewalk import iter_image_files
from .fingerprint import (
    ImageFingerprint,
    ensure_image_dependencies,
    fingerprint_image,
    is_reusable,
)
from .grouping import SimilarGroup, build_similar_groups
from .index import load_image_index, save_image_index


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


def _record_error(result: SimilarImageResult, message: str, *, max_errors: int) -> None:
    result.error_count += 1
    if len(result.errors) < max_errors:
        result.errors.append(message)


def _progress_step(total: int, requested_interval: int) -> int:
    """Throttle progress emissions so very large libraries don't drown the IPC.

    Returns 0 when no emission is desired. Otherwise it's the smaller of
    ``requested_interval`` and ``total // 200`` (i.e. ≤ ~200 progress events
    per scan), but never below 1.
    """
    if requested_interval <= 0 or total <= 0:
        return 0
    return max(1, min(requested_interval, max(1, total // 200)))


def find_similar_images(
    roots: list[Path],
    *,
    index_path: Path = DEFAULT_IMAGE_INDEX,
    exclude_roots: list[Path] | None = None,
    threshold: str = "likely",
    max_errors: int = 200,
    progress_callback: ProgressCallback | None = None,
    progress_interval: int = 100,
    checkpoint_interval: int = 250,
    skip_same_pixiv_work_pages: bool = False,
) -> SimilarImageResult:
    if threshold not in {"likely", "possible"}:
        raise ValueError("threshold must be 'likely' or 'possible'")
    ensure_image_dependencies()
    old_index = load_image_index(index_path)
    entries: list[ImageFingerprint] = []
    result = SimilarImageResult(roots=[str(Path(root).resolve()) for root in roots], index_path=index_path)
    emit(progress_callback, PROGRESS_SIMILAR_START, roots=len(roots))
    image_paths = list(iter_image_files(roots, exclude_roots))
    total_files = len(image_paths)
    emit(
        progress_callback,
        PROGRESS_SIMILAR_FILES,
        files=0,
        total_files=total_files,
        indexed=0,
        changed=0,
        reused=0,
        errors=0,
    )
    changed_since_checkpoint = 0
    index_progress_step = _progress_step(total_files, progress_interval)

    for position, path in enumerate(image_paths, start=1):
        if progress_callback and index_progress_step and (position == 1 or (position - 1) % index_progress_step == 0):
            emit(
                progress_callback,
                PROGRESS_SIMILAR_FILE_START,
                files=position,
                completed=result.files_seen,
                total_files=total_files,
                indexed=len(entries),
                changed=result.changed,
                reused=result.reused,
                errors=result.error_count,
                name=path.name,
            )
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
                changed_since_checkpoint += 1
            except Exception as exc:  # noqa: BLE001 -- per-file error boundary, broad on purpose
                _record_error(result, f"{path}: {exc}", max_errors=max_errors)
        if progress_callback and index_progress_step and (
            result.files_seen % index_progress_step == 0 or result.files_seen == total_files
        ):
            emit(
                progress_callback,
                PROGRESS_SIMILAR_FILES,
                files=result.files_seen,
                total_files=total_files,
                indexed=len(entries),
                changed=result.changed,
                reused=result.reused,
                errors=result.error_count,
            )
        if checkpoint_interval > 0 and changed_since_checkpoint >= checkpoint_interval:
            # Flush the partial index so a crash mid-scan doesn't lose all the
            # hashing work that's accumulated since the last save.
            save_image_index(entries, index_path)
            changed_since_checkpoint = 0
            emit(
                progress_callback,
                PROGRESS_SIMILAR_INDEX_SAVED,
                files=result.files_seen,
                total_files=total_files,
                indexed=len(entries),
                changed=result.changed,
                reused=result.reused,
                errors=result.error_count,
            )

    result.indexed = len(entries)
    emit(
        progress_callback,
        PROGRESS_SIMILAR_FILES,
        files=result.files_seen,
        total_files=total_files,
        indexed=len(entries),
        changed=result.changed,
        reused=result.reused,
        errors=result.error_count,
    )
    result.groups = build_similar_groups(
        entries,
        threshold=threshold,
        skip_same_pixiv_work_pages=skip_same_pixiv_work_pages,
        progress_callback=progress_callback,
        progress_interval=max(1000, progress_interval * 10),
    )
    save_image_index(entries, index_path)
    emit(
        progress_callback,
        PROGRESS_SIMILAR_DONE,
        files=result.files_seen,
        total_files=total_files,
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
