"""Incremental Pixiv tag-fetch workflow.

Fetching is driven off a PID-keyed sidecar cache (``library.tag_cache``): a
work whose tags were fetched successfully is never asked for again unless the
caller forces it, while a work whose fetch failed is retried on the next run.
Results are checkpointed periodically so a crash or a cancel keeps whatever the
run already paid for.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from .. import resolver
from ..events import PROGRESS_FETCH_TAGS_DONE, PROGRESS_FETCH_TAGS_ITEM, PROGRESS_FETCH_TAGS_START
from ..library.catalog import LibraryImage
from ..library.tag_cache import (
    TagCacheEntry,
    apply_tag_cache,
    load_tag_cache,
    merge_tag_cache,
    needs_fetch,
    save_tag_cache,
    seed_tag_cache_from_images,
)
from ._shared import ProgressCallback, emit

# ``fetch_artwork_tags`` is looked up through its parent module at call time so
# tests can patch ``pixiv_pbd_manager.resolver.fetch_artwork_tags`` and see the
# patch take effect here (same rationale as ``operations.updates``).


@dataclass
class TagFetchResult:
    total: int = 0  # pids in scope
    attempted: int = 0  # pids we issued a request for (== total - skipped)
    fetched: int = 0  # requests that succeeded this run
    failed: int = 0  # requests that raised PixivResolveError this run
    skipped: int = 0  # pids served from the cache with no request (includes seeded)
    seeded: int = 0  # pids adopted from the catalog during the one-time migration
    cached: int = 0  # entries in the sidecar after the run
    updated_images: int = 0
    cancelled: bool = False
    errors: list[str] = field(default_factory=list)


# One flush protects ~20 s of work at the default 0.8 s delay, and costs one
# rewrite of the catalog (~100-300 ms on a 50k-image library) — about 1% of what
# it protects. A parameter rather than a constant so tests can checkpoint hard.
DEFAULT_FLUSH_EVERY = 25


def fetch_pixiv_tags(
    images: list[LibraryImage],
    *,
    cache_path: Path,
    force: bool = False,
    pixiv_cookie: str | None = None,
    allow_insecure_ssl_fallback: bool = True,
    delay_seconds: float = 0.8,
    flush_every: int = DEFAULT_FLUSH_EVERY,
    on_flush: Callable[[dict[str, list[dict[str, str]]]], None] | None = None,
    progress_callback: ProgressCallback | None = None,
    should_cancel: Callable[[], bool] | None = None,
    now: Callable[[], float] = time.time,
    sleep: Callable[[float], None] = time.sleep,
) -> TagFetchResult:
    """Fetch tags for every distinct work id among ``images``.

    Tags are mirrored onto every image sharing a pid, so a multi-page work
    costs one request. Images without a pid are ignored — they are not
    addressable on Pixiv. ``on_flush`` receives the pid → tags mapping changed
    since the previous flush, and is responsible for persisting the catalog;
    the sidecar itself is written here.
    """
    result = TagFetchResult()

    by_pid: dict[str, list[LibraryImage]] = {}
    for image in images:
        if image.pid:
            by_pid.setdefault(image.pid, []).append(image)
    result.total = len(by_pid)

    cache = load_tag_cache(cache_path)
    result.seeded = seed_tag_cache_from_images(cache, images, now=now())

    # Hydrate before any network work: a moved or renamed file gets its tags
    # back even on a run that fetches nothing at all.
    dirty: dict[str, list[dict[str, str]]] = {}
    for pid in apply_tag_cache(images, cache):
        entry = cache.get(pid)
        if entry is not None:
            dirty[pid] = [dict(item) for item in entry.tags]
    result.updated_images = sum(len(by_pid.get(pid, ())) for pid in dirty)

    pending = [pid for pid in by_pid if needs_fetch(cache.get(pid), force=force)]
    result.attempted = len(pending)
    result.skipped = result.total - result.attempted

    since_flush = 0

    def flush() -> None:
        nonlocal since_flush
        save_tag_cache(merge_tag_cache(load_tag_cache(cache_path), cache), cache_path)
        if dirty and on_flush is not None:
            on_flush(dict(dirty))
        dirty.clear()
        since_flush = 0

    emit(
        progress_callback,
        PROGRESS_FETCH_TAGS_START,
        total=result.attempted,
        total_pids=result.total,
        skipped=result.skipped,
        seeded=result.seeded,
        force=force,
    )

    for index, pid in enumerate(pending, 1):
        # Checked at the top so a cancel never lands between the request and the
        # cache write for the same pid.
        if should_cancel is not None and should_cancel():
            result.cancelled = True
            break
        previous = cache.get(pid)
        attempts = (previous.attempts if previous else 0) + 1
        try:
            tags, _ssl_used = resolver.fetch_artwork_tags(
                pid,
                cookie=pixiv_cookie,
                allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
            )
            pixiv_tags = [{"tag": tag.tag, "translation": tag.translation} for tag in tags]
            cache[pid] = TagCacheEntry(
                pid=pid,
                tags=pixiv_tags,
                fetched_at=now(),
                ok=True,
                source="fetch",
                attempts=attempts,
            )
            for image in by_pid[pid]:
                image.pixiv_tags = [dict(item) for item in pixiv_tags]
            dirty[pid] = [dict(item) for item in pixiv_tags]
            result.fetched += 1
            result.updated_images += len(by_pid[pid])
        except resolver.PixivResolveError as exc:
            # Record the failure but leave the images alone: whatever tags they
            # already carry are better than none.
            cache[pid] = TagCacheEntry(
                pid=pid,
                tags=list(previous.tags) if previous else [],
                fetched_at=now(),
                ok=False,
                error=str(exc),
                source="fetch",
                attempts=attempts,
            )
            result.failed += 1
            result.errors.append(f"{pid}: {exc}")
        since_flush += 1
        emit(
            progress_callback,
            PROGRESS_FETCH_TAGS_ITEM,
            current=index,
            total=result.attempted,
            pid=pid,
            fetched=result.fetched,
            failed=result.failed,
            skipped=result.skipped,
            errors=result.failed,
        )
        if flush_every > 0 and since_flush >= flush_every:
            flush()
        if delay_seconds > 0 and index < len(pending):
            sleep(delay_seconds)

    flush()
    result.cached = len(cache)
    emit(
        progress_callback,
        PROGRESS_FETCH_TAGS_DONE,
        total=result.attempted,
        total_pids=result.total,
        updated=result.fetched,
        fetched=result.fetched,
        failed=result.failed,
        skipped=result.skipped,
        seeded=result.seeded,
        cached=result.cached,
        errors=result.failed,
        cancelled=result.cancelled,
    )
    return result
