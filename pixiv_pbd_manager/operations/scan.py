"""Scan workflow: merge-write, dry-run preview, and apply-selected-changes.

The bulk of the actual scanning and online resolving lives in
``_scan_pipeline.collect_resolved_hits``. The two public entry points here are
thin: each calls the pipeline, then walks the resulting hits in its own way.

* ``scan_into_database`` mutates the DB right away (the old "scan" semantics).
* ``preview_scan_changes`` returns a list of stable, JSON-shaped diff items
  the GUI presents in a checkbox dialog. Names and save_paths attached to
  existing artists become opt-in diff entries, so a user who manually renamed
  an artist won't have that name silently overwritten by a rescan.
* ``apply_scan_changes`` writes back only the diff items the user accepted.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from ..database import ArtistDatabase
from ..models import ArtistRecord, utc_now
from ..scanner import ScanSummary, is_relative_to
from ._scan_pipeline import ResolvedHit, collect_resolved_hits
from ._shared import (
    ProgressCallback,
    artist_save_roots,
    is_under_known_save_root,
)


@dataclass
class ScanResult:
    summary: ScanSummary
    changed: int
    db_path: Path
    resolved_name_only: int = 0
    resolved_by_pid: int = 0
    fuzzy_resolved_name_only: int = 0
    ssl_fallback_used: int = 0
    resolve_errors: list[str] = field(default_factory=list)
    cancelled: bool = False


@dataclass
class ScanPreviewResult:
    changes: list[dict] = field(default_factory=list)
    summary: ScanSummary | None = None
    resolved_name_only: int = 0
    resolved_by_pid: int = 0
    fuzzy_resolved_name_only: int = 0
    ssl_fallback_used: int = 0
    resolve_errors: list[str] = field(default_factory=list)
    cancelled: bool = False


@dataclass
class ScanApplyResult:
    applied: int = 0
    new_artists: int = 0
    name_changes: int = 0
    save_paths_added: int = 0
    work_ids_added: int = 0
    db_path: Path | None = None


# ---------- internal helpers (artist-record-aware) ----------


def _is_under_artist_save_path(artist: ArtistRecord, path: Path | str | None) -> bool:
    if not path:
        return False
    return is_under_known_save_root(Path(path), artist_save_roots(artist))


def _manual_replacement_for_artist_id(db: ArtistDatabase, artist_id: str) -> ArtistRecord | None:
    prefix = f"manual_id_edit:{artist_id}->"
    for artist in db.artists.values():
        if any(str(source).startswith(prefix) for source in artist.sources):
            return artist
    return None


def _existing_artist_for_save_paths(db: ArtistDatabase, save_paths: list[str]) -> ArtistRecord | None:
    proposed_paths = [Path(path).expanduser().resolve() for path in save_paths if path]
    if not proposed_paths:
        return None
    for artist in db.artists.values():
        existing_roots = artist_save_roots(artist)
        if any(proposed == root or is_relative_to(proposed, root) for proposed in proposed_paths for root in existing_roots):
            return artist
    return None


def _existing_or_redirected_artist(
    db: ArtistDatabase,
    artist_id: str,
    save_paths: list[str],
) -> tuple[ArtistRecord | None, bool]:
    """Return (record, redirected). ``redirected`` is True iff a different id
    in the DB owns this artist (because the user renamed the id, or because a
    proposed save_path already lives under another artist's tree)."""
    existing = db.artists.get(artist_id)
    if existing is not None:
        return existing, False
    replacement = _manual_replacement_for_artist_id(db, artist_id)
    if replacement is not None:
        return replacement, True
    existing_by_path = _existing_artist_for_save_paths(db, save_paths)
    if existing_by_path is not None:
        return existing_by_path, True
    return None, False


def _merge_scan_hit(db: ArtistDatabase, hit: ResolvedHit) -> bool:
    existing, redirected = _existing_or_redirected_artist(
        db, hit.artist_id, [str(hit.folder)] if hit.folder else []
    )
    target_id = existing.id if existing else hit.artist_id
    target_name = hit.artist_name if existing is None or not existing.name else None
    target_save_path = None if existing and _is_under_artist_save_path(existing, hit.folder) else hit.folder
    target_source = f"{hit.source};redirected_from:{hit.artist_id}" if redirected else hit.source
    return db.upsert(
        target_id,
        name=target_name,
        source=target_source,
        root=hit.root,
        save_path=target_save_path,
        work_ids=set(hit.work_ids),
    )


def _accumulate_hit(proposed: dict[str, dict], hit: ResolvedHit) -> None:
    bucket = proposed.setdefault(
        hit.artist_id,
        {"name": "", "sources": [], "roots": [], "save_paths": [], "work_ids": set()},
    )
    if hit.artist_name and not bucket["name"]:
        bucket["name"] = hit.artist_name
    if hit.source and hit.source not in bucket["sources"]:
        bucket["sources"].append(hit.source)
    if hit.root:
        text = str(Path(hit.root).resolve())
        if text not in bucket["roots"]:
            bucket["roots"].append(text)
    if hit.folder:
        text = str(Path(hit.folder).resolve())
        if text not in bucket["save_paths"]:
            bucket["save_paths"].append(text)
    if hit.work_ids:
        bucket["work_ids"].update(str(w) for w in hit.work_ids)


def _build_diff_changes(proposed: dict[str, dict], db: ArtistDatabase) -> list[dict]:
    """Turn the proposed-hits bucket into the JSON diff items the GUI shows."""
    changes: list[dict] = []
    for artist_id in sorted(proposed.keys(), key=lambda value: (len(value), value)):
        prop = proposed[artist_id]
        existing, redirected = _existing_or_redirected_artist(db, artist_id, list(prop["save_paths"]))
        if existing is None:
            changes.append(
                {
                    "id": f"new_artist:{artist_id}",
                    "kind": "new_artist",
                    "artist_id": artist_id,
                    "name": prop["name"],
                    "sources": list(prop["sources"]),
                    "roots": list(prop["roots"]),
                    "save_paths": list(prop["save_paths"]),
                    "work_ids": sorted(prop["work_ids"], key=lambda v: (len(v), v)),
                }
            )
            continue
        change_key = artist_id if not redirected else f"{artist_id}->{existing.id}"
        if not redirected and prop["name"] and prop["name"] != (existing.name or ""):
            changes.append(
                {
                    "id": f"name_change:{artist_id}",
                    "kind": "name_change",
                    "artist_id": artist_id,
                    "old_name": existing.name or "",
                    "new_name": prop["name"],
                }
            )
        existing_paths = set(existing.save_paths)
        added_paths = [
            p for p in prop["save_paths"] if p not in existing_paths and not _is_under_artist_save_path(existing, p)
        ]
        if added_paths:
            changes.append(
                {
                    "id": f"add_save_paths:{change_key}",
                    "kind": "add_save_paths",
                    "artist_id": existing.id,
                    "name": existing.name or "",
                    "existing": list(existing.save_paths),
                    "paths": added_paths,
                }
            )
        existing_works = set(existing.work_ids)
        added_works = sorted(prop["work_ids"] - existing_works, key=lambda v: (len(v), v))
        if added_works:
            changes.append(
                {
                    "id": f"add_work_ids:{change_key}",
                    "kind": "add_work_ids",
                    "artist_id": existing.id,
                    "name": existing.name or "",
                    "existing_count": len(existing.work_ids),
                    "work_ids": added_works,
                }
            )
    return changes


# ---------- public entry points ----------


def scan_into_database(
    roots: list[Path],
    db_path: Path,
    *,
    resolve_online: bool = False,
    resolve_limit: int = 3,
    resolve_delay: float = 0.8,
    pixiv_cookie: str | None = None,
    allow_insecure_ssl_fallback: bool = True,
    exclude_roots: list[Path] | None = None,
    fuzzy_search_names: bool = False,
    fuzzy_min_score: float = 0.35,
    max_depth: int | None = None,
    allow_low_pids: bool = False,
    should_cancel: Callable[[], bool] | None = None,
    progress_callback: ProgressCallback | None = None,
) -> ScanResult:
    db = ArtistDatabase.load(db_path)
    pipeline = collect_resolved_hits(
        roots,
        existing_db=db,
        resolve_online=resolve_online,
        resolve_limit=resolve_limit,
        resolve_delay=resolve_delay,
        pixiv_cookie=pixiv_cookie,
        allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
        exclude_roots=exclude_roots,
        fuzzy_search_names=fuzzy_search_names,
        fuzzy_min_score=fuzzy_min_score,
        max_depth=max_depth,
        allow_low_pids=allow_low_pids,
        should_cancel=should_cancel,
        progress_callback=progress_callback,
    )
    # On cancel, don't write a partial scan into the DB; report it as cancelled.
    if pipeline.cancelled:
        return ScanResult(
            summary=pipeline.summary,
            changed=0,
            db_path=db.path.resolve(),
            resolve_errors=pipeline.resolve_errors,
            cancelled=True,
        )
    changed = sum(1 for hit in pipeline.hits if _merge_scan_hit(db, hit))
    db.save()
    return ScanResult(
        summary=pipeline.summary,
        changed=changed,
        db_path=db.path.resolve(),
        resolved_name_only=pipeline.resolved_name_only,
        resolved_by_pid=pipeline.resolved_by_pid,
        fuzzy_resolved_name_only=pipeline.fuzzy_resolved_name_only,
        ssl_fallback_used=pipeline.ssl_fallback_used,
        resolve_errors=pipeline.resolve_errors,
    )


def preview_scan_changes(
    roots: list[Path],
    db_path: Path,
    *,
    resolve_online: bool = False,
    resolve_limit: int = 3,
    resolve_delay: float = 0.8,
    pixiv_cookie: str | None = None,
    allow_insecure_ssl_fallback: bool = True,
    exclude_roots: list[Path] | None = None,
    fuzzy_search_names: bool = False,
    fuzzy_min_score: float = 0.35,
    max_depth: int | None = None,
    allow_low_pids: bool = False,
    should_cancel: Callable[[], bool] | None = None,
    progress_callback: ProgressCallback | None = None,
) -> ScanPreviewResult:
    """Run the scan but produce a diff of proposed changes instead of writing.

    The diff items are stable JSON objects keyed by ``id`` that the GUI presents
    in a checkbox dialog; ``apply_scan_changes`` then writes only the user's
    selection. Existing names and save paths are never touched unless the user
    explicitly accepts the matching change.
    """
    db = ArtistDatabase.load(db_path)
    pipeline = collect_resolved_hits(
        roots,
        existing_db=db,
        resolve_online=resolve_online,
        resolve_limit=resolve_limit,
        resolve_delay=resolve_delay,
        pixiv_cookie=pixiv_cookie,
        allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
        exclude_roots=exclude_roots,
        fuzzy_search_names=fuzzy_search_names,
        fuzzy_min_score=fuzzy_min_score,
        max_depth=max_depth,
        allow_low_pids=allow_low_pids,
        should_cancel=should_cancel,
        progress_callback=progress_callback,
    )
    proposed: dict[str, dict] = {}
    for hit in pipeline.hits:
        _accumulate_hit(proposed, hit)
    return ScanPreviewResult(
        changes=_build_diff_changes(proposed, db),
        summary=pipeline.summary,
        resolved_name_only=pipeline.resolved_name_only,
        resolved_by_pid=pipeline.resolved_by_pid,
        fuzzy_resolved_name_only=pipeline.fuzzy_resolved_name_only,
        ssl_fallback_used=pipeline.ssl_fallback_used,
        resolve_errors=pipeline.resolve_errors,
        cancelled=pipeline.cancelled,
    )


def apply_scan_changes(db_path: Path, operations: list[dict]) -> ScanApplyResult:
    """Apply a user-selected subset of scan changes to the database."""
    db = ArtistDatabase.load(db_path)
    result = ScanApplyResult(db_path=db.path.resolve())

    for op in operations or []:
        kind = op.get("kind")
        artist_id = str(op.get("artist_id") or "").strip()
        if not artist_id.isdigit():
            continue

        if kind == "new_artist":
            artist = db.artists.get(artist_id)
            if artist is None:
                artist = ArtistRecord(id=artist_id, name=(op.get("name") or None))
                db.artists[artist_id] = artist
                result.new_artists += 1
            for src in op.get("sources") or []:
                if src and src not in artist.sources:
                    artist.sources.append(src)
            for root in op.get("roots") or []:
                if root and root not in artist.download_roots:
                    artist.download_roots.append(root)
            for sp in op.get("save_paths") or []:
                if sp and sp not in artist.save_paths:
                    artist.save_paths.append(sp)
            new_ids = {str(w) for w in op.get("work_ids") or []}
            if new_ids:
                existing_ids = set(artist.work_ids)
                added = new_ids - existing_ids
                if added:
                    artist.work_ids = sorted(existing_ids | added, key=lambda v: (len(v), v))
                    artist.new_work_ids = sorted(
                        set(artist.new_work_ids) - added, key=lambda v: (len(v), v)
                    )
            artist.last_seen = utc_now()
            result.applied += 1

        elif kind == "name_change":
            artist = db.artists.get(artist_id)
            new_name = (op.get("new_name") or "").strip()
            if artist and new_name and new_name != artist.name:
                artist.name = new_name
                artist.last_seen = utc_now()
                result.name_changes += 1
                result.applied += 1

        elif kind == "add_save_paths":
            artist = db.artists.get(artist_id)
            if artist:
                added_count = 0
                for path in op.get("paths") or []:
                    if path and path not in artist.save_paths:
                        artist.save_paths.append(path)
                        added_count += 1
                if added_count:
                    artist.last_seen = utc_now()
                    result.save_paths_added += added_count
                    result.applied += 1

        elif kind == "add_work_ids":
            artist = db.artists.get(artist_id)
            if artist:
                wanted = {str(w) for w in op.get("work_ids") or []}
                existing = set(artist.work_ids)
                added = wanted - existing
                if added:
                    artist.work_ids = sorted(existing | added, key=lambda v: (len(v), v))
                    artist.new_work_ids = sorted(
                        set(artist.new_work_ids) - added, key=lambda v: (len(v), v)
                    )
                    artist.last_seen = utc_now()
                    result.work_ids_added += len(added)
                    result.applied += 1

    db.save()
    return result
