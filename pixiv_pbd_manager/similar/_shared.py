"""Shared progress-callback plumbing for the similar-image pipeline."""

from __future__ import annotations

from collections.abc import Callable


ProgressCallback = Callable[[str, dict[str, object]], None]


def emit(progress_callback: ProgressCallback | None, key: str, **kwargs: object) -> None:
    if progress_callback:
        progress_callback(key, kwargs)
