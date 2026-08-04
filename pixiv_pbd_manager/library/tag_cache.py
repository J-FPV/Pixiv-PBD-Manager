"""PID-keyed sidecar cache of fetched Pixiv artwork tags.

Lives at ``DATA_DIR/pixiv_tags.json`` and is the source of truth for
``LibraryImage.pixiv_tags``; the catalog only mirrors it for display and
filtering. Keying on the Pixiv work id rather than the file path is what makes
tags survive the moves and renames that cleanup performs — ``build_catalog``
carries tags forward via ``old_catalog[resolved_path]``, so a moved file used
to lose them and force a full refetch.

The refresh rule is deliberately simple: a successful fetch is never repeated
unless the caller forces it, and a failed one is retried on the next normal
run. Pixiv tags rarely change after upload, so there is no TTL.
"""

from __future__ import annotations

import json
import time
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..paths import DEFAULT_PIXIV_TAG_CACHE, write_json_atomic
from .catalog import LibraryImage, _clean_pixiv_tags


__all__ = [
    "DEFAULT_PIXIV_TAG_CACHE",
    "TAG_CACHE_VERSION",
    "TagCacheEntry",
    "apply_tag_cache",
    "load_tag_cache",
    "merge_tag_cache",
    "needs_fetch",
    "save_tag_cache",
    "seed_tag_cache_from_images",
]

TAG_CACHE_VERSION = 1


@dataclass
class TagCacheEntry:
    """One artwork's fetch record.

    ``ok=True`` with an empty ``tags`` list is a meaningful state: the artwork
    genuinely has no tags. That is exactly the case the old catalog-only
    storage could not express, which is why nothing could be skipped.
    """

    pid: str
    tags: list[dict[str, str]] = field(default_factory=list)
    fetched_at: float = 0.0
    ok: bool = True
    error: str = ""
    source: str = "fetch"  # "fetch" | "catalog" (one-time seed from the index)
    attempts: int = 0  # reserved: lets a failure back-off land without a migration

    @classmethod
    def from_json(cls, raw: dict[str, Any]) -> "TagCacheEntry":
        return cls(
            pid=str(raw["pid"]),
            tags=_clean_pixiv_tags(raw.get("tags")),
            fetched_at=float(raw.get("fetched_at") or 0.0),
            ok=bool(raw.get("ok", True)),
            error=str(raw.get("error") or ""),
            source=str(raw.get("source") or "fetch"),
            attempts=int(raw.get("attempts") or 0),
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "pid": self.pid,
            "tags": _clean_pixiv_tags(self.tags),
            "fetched_at": float(self.fetched_at),
            "ok": bool(self.ok),
            "error": self.error,
            "source": self.source,
            "attempts": int(self.attempts),
        }


def load_tag_cache(path: Path = DEFAULT_PIXIV_TAG_CACHE) -> dict[str, TagCacheEntry]:
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    entries = raw.get("entries") or {}
    result: dict[str, TagCacheEntry] = {}
    for pid, item in entries.items():
        if not isinstance(item, dict):
            continue
        try:
            entry = TagCacheEntry.from_json({**item, "pid": str(item.get("pid") or pid)})
        except (KeyError, TypeError, ValueError):
            continue
        if entry.pid:
            result[entry.pid] = entry
    return result


def save_tag_cache(
    entries: Mapping[str, TagCacheEntry] | Iterable[TagCacheEntry],
    path: Path = DEFAULT_PIXIV_TAG_CACHE,
) -> None:
    values = list(entries.values()) if isinstance(entries, Mapping) else list(entries)
    # Work ids sort shortest-first then lexically, matching operations/scan.py.
    ordered = sorted(values, key=lambda entry: (len(entry.pid), entry.pid))
    write_json_atomic(
        path,
        {"version": TAG_CACHE_VERSION, "entries": {entry.pid: entry.to_json() for entry in ordered}},
    )


def merge_tag_cache(
    base: dict[str, TagCacheEntry],
    incoming: Mapping[str, TagCacheEntry],
) -> dict[str, TagCacheEntry]:
    """Combine two cache snapshots, newest ``fetched_at`` winning per pid.

    Used at every flush so a long fetch run does not clobber entries written by
    a concurrent process (another fetch, or the seed inside ``library.scan``).
    """
    merged = dict(base)
    for pid, entry in incoming.items():
        current = merged.get(pid)
        if current is None or entry.fetched_at >= current.fetched_at:
            merged[pid] = entry
    return merged


def needs_fetch(entry: TagCacheEntry | None, *, force: bool = False) -> bool:
    """A successful fetch is never repeated unless forced; failures retry."""
    return force or entry is None or not entry.ok


def apply_tag_cache(
    images: Iterable[LibraryImage],
    cache: Mapping[str, TagCacheEntry],
) -> set[str]:
    """Mirror cached tags onto every image sharing the pid.

    Returns the pids whose images actually changed, so the caller knows what to
    persist. ``ok=False`` entries are skipped: a failed fetch must never erase
    tags the catalog still holds.
    """
    changed: set[str] = set()
    for image in images:
        entry = cache.get(image.pid) if image.pid else None
        if entry is None or not entry.ok:
            continue
        if image.pixiv_tags == entry.tags:
            continue
        image.pixiv_tags = [dict(item) for item in entry.tags]
        changed.add(image.pid)
    return changed


def seed_tag_cache_from_images(
    cache: dict[str, TagCacheEntry],
    images: Iterable[LibraryImage],
    *,
    now: float | None = None,
) -> int:
    """One-time migration: adopt tags the catalog already holds.

    Mutates ``cache`` in place and returns how many pids were adopted. Only
    pids the cache does not know yet **and** that carry non-empty catalog tags
    are seeded. Empty catalog tags are ambiguous — "never fetched" and "this
    artwork has no tags" look identical there — so they are left alone: not
    seeding a genuinely tagless work costs one request, once, ever, whereas
    wrongly seeding a never-fetched one hides its real tags permanently.
    """
    stamp = time.time() if now is None else now
    seeded = 0
    for image in images:
        if not image.pid or image.pid in cache:
            continue
        tags = _clean_pixiv_tags(image.pixiv_tags)
        if not tags:
            continue
        cache[image.pid] = TagCacheEntry(
            pid=image.pid,
            tags=tags,
            fetched_at=stamp,
            ok=True,
            source="catalog",
        )
        seeded += 1
    return seeded
