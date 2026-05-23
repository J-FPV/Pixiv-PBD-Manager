"""Shared scan + online-resolve pipeline used by both write and dry-run paths.

``scan_into_database`` and ``preview_scan_changes`` used to be two ~130-line
near-duplicates that differed only in *what they did with each resolved hit*
(merge into the DB vs. accumulate into a proposed-diff dict). This module
factors out the common pre-processing: walking the roots, filtering unmatched
folders the user already attributed, then running the optional name-only
artwork-id resolver and fuzzy name-search resolver to upgrade name-only hits
into id-anchored hits.

The result is a flat list of ``ResolvedHit`` records the callers iterate
over. The order is stable:

  1. Hits found by the local id-pattern matchers
  2. Hits resolved online from sample artwork IDs (if ``resolve_online``)
  3. Hits resolved by Pixiv user search (if ``resolve_online`` and
     ``fuzzy_search_names``, only for name-only folders the previous step
     did not handle)

Either resolver loop short-circuits if Pixiv returns a ``PixivResolveError``,
matching the historical behaviour: one transient failure stops the whole
online-resolve phase rather than spamming the API.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .. import resolver
from ..database import ArtistDatabase
from ..events import (
    PROGRESS_FUZZY_ARTIST,
    PROGRESS_RESOLVE_ARTIST,
    PROGRESS_SCAN_DONE,
    PROGRESS_SCAN_FILES,
    PROGRESS_SCAN_START,
)
from ..scanner import ScanSummary, scan_roots
from ._shared import ProgressCallback, emit, filter_assigned_unmatched_folders

# Resolvers are looked up via the ``resolver`` module at call time (rather than
# imported as bare names) so tests can patch ``pixiv_pbd_manager.resolver.*``
# and see the patch take effect here.


@dataclass(frozen=True)
class ResolvedHit:
    """One artist match the pipeline produced, ready to merge or diff."""

    artist_id: str
    artist_name: str | None
    source: str
    root: Path
    folder: Path
    work_ids: frozenset[str]


@dataclass
class ScanPipelineResult:
    summary: ScanSummary
    hits: list[ResolvedHit] = field(default_factory=list)
    resolved_name_only: int = 0
    fuzzy_resolved_name_only: int = 0
    ssl_fallback_used: int = 0
    resolve_errors: list[str] = field(default_factory=list)


def collect_resolved_hits(
    roots: list[Path],
    *,
    existing_db: ArtistDatabase,
    resolve_online: bool = False,
    resolve_limit: int = 3,
    resolve_delay: float = 0.8,
    pixiv_cookie: str | None = None,
    allow_insecure_ssl_fallback: bool = True,
    exclude_roots: list[Path] | None = None,
    fuzzy_search_names: bool = False,
    fuzzy_min_score: float = 0.35,
    progress_callback: ProgressCallback | None = None,
) -> ScanPipelineResult:
    emit(progress_callback, PROGRESS_SCAN_START, roots=len(roots))
    summary = scan_roots(
        roots,
        exclude_roots=exclude_roots,
        progress_callback=lambda item: emit(
            progress_callback,
            PROGRESS_SCAN_FILES,
            files=item.files_seen,
            matched=item.files_matched,
            name_only=len(item.name_only_artists),
        ),
    )
    emit(
        progress_callback,
        PROGRESS_SCAN_DONE,
        files=summary.files_seen,
        matched=summary.files_matched,
        name_only=len(summary.name_only_artists),
    )
    filter_assigned_unmatched_folders(summary, existing_db)

    result = ScanPipelineResult(summary=summary)

    for artist_id, hit in summary.artists.items():
        result.hits.append(
            ResolvedHit(
                artist_id=artist_id,
                artist_name=hit.artist_name,
                source=hit.source,
                root=hit.root,
                folder=hit.folder,
                work_ids=frozenset(hit.work_ids),
            )
        )

    if not resolve_online:
        return result

    resolved_hit_keys: set[str] = set()
    name_only_hits = list(summary.name_only_artists.values())

    for index, hit in enumerate(name_only_hits, 1):
        if not hit.work_ids:
            continue
        emit(
            progress_callback,
            PROGRESS_RESOLVE_ARTIST,
            current=index,
            total=len(name_only_hits),
            name=hit.artist_name,
        )
        try:
            resolved = resolver.resolve_name_only_artist(
                hit,
                max_work_ids=max(1, resolve_limit),
                delay_seconds=max(0.0, resolve_delay),
                cookie=pixiv_cookie,
                allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
            )
        except resolver.PixivResolveError as exc:
            result.resolve_errors.append(str(exc))
            break
        if not resolved:
            continue
        if resolved.ssl_fallback_used:
            result.ssl_fallback_used += 1
        source = f"{hit.source};resolved_by_work:{resolved.work_id}"
        result.hits.append(
            ResolvedHit(
                artist_id=resolved.id,
                artist_name=resolved.name or hit.artist_name,
                source=source,
                root=hit.root,
                folder=hit.folder,
                work_ids=frozenset(hit.work_ids),
            )
        )
        result.resolved_name_only += 1
        resolved_hit_keys.add(hit.artist_key)

    if not fuzzy_search_names:
        return result

    for index, hit in enumerate(name_only_hits, 1):
        if hit.artist_key in resolved_hit_keys:
            continue
        emit(
            progress_callback,
            PROGRESS_FUZZY_ARTIST,
            current=index,
            total=len(name_only_hits),
            name=hit.artist_name,
        )
        try:
            candidate = resolver.resolve_name_by_fuzzy_search(
                hit.artist_name,
                min_score=fuzzy_min_score,
                cookie=pixiv_cookie,
                allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
            )
        except resolver.PixivResolveError as exc:
            result.resolve_errors.append(str(exc))
            break
        if not candidate:
            continue
        if candidate.ssl_fallback_used:
            result.ssl_fallback_used += 1
        source = f"{hit.source};fuzzy_search:{hit.artist_name};score:{candidate.score:.2f}"
        result.hits.append(
            ResolvedHit(
                artist_id=candidate.id,
                artist_name=candidate.name or hit.artist_name,
                source=source,
                root=hit.root,
                folder=hit.folder,
                work_ids=frozenset(hit.work_ids),
            )
        )
        result.fuzzy_resolved_name_only += 1

    return result
