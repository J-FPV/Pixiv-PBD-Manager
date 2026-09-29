"""Folder-local review commands. Network I/O is outside the commit lock."""

import time
from pathlib import Path

from ... import resolver
from ...cookie_store import load_cookie
from ...database import ArtistDatabase
from ...events import PROGRESS_SCAN_REVIEW
from ...operations.scan import _accumulate_hit, _build_diff_changes, apply_scan_changes
from ...operations.scan import preview_scan_changes
from ...operations._scan_pipeline import ResolvedHit
from ...recovery import ACTIVE
from ...scan_review import database_signature, open_reviews, snapshot, status_for
from ..payload import db_path
from ..runtime import CONTROL
from ..serializers import artist_to_json
from .settings import load_settings_for_payload


def _current(item):
    current = snapshot(item["path"], item.get("excludes", []), item.get("max_depth"))
    return {**item, "unavailable": current["unavailable"],
            "stale": item.get("stale", False) or current["fingerprint"] != item.get("fingerprint")}


def list_items(payload, _emit):
    settings = load_settings_for_payload(payload)
    with open_reviews(payload, settings) as store:
        # INSERT-only migration; a path/count cache never supplies a candidate.
        store.db.execute("CREATE TABLE IF NOT EXISTS migrations (dataset TEXT PRIMARY KEY)")
        if payload.get("legacy_folders") and not store.db.execute("SELECT 1 FROM migrations WHERE dataset=?", (store.dataset,)).fetchone():
            existing = {item["path"] for item in store.rows()}
            for legacy in payload["legacy_folders"]:
                path = str(Path(legacy["path"]).resolve())
                if path not in existing:
                    store.save({"path": path, "count": legacy.get("count", 0), "queries": [], "candidates": [],
                                "samples": {}, "name_hint": "", "stale": True, "unverified": True})
            with store.db:
                store.db.execute("INSERT OR IGNORE INTO migrations VALUES (?)", (store.dataset,))
        store.discard_assigned(ArtistDatabase.load(db_path(payload, settings)), settings.get("exclude_roots", []))
        # Listing doesn't walk the library. Detail/apply verify metadata; watcher marks dirty rows.
        rows = []
        for item in store.rows():
            rows.append({key: value for key, value in item.items() if key not in ("samples", "sample_paths", "work_ids", "excludes")})
        return {"items": rows}


def detail(payload, _emit):
    settings = load_settings_for_payload(payload)
    with open_reviews(payload, settings) as store:
        item = _current(store.get(payload["path"]))
        item["stale"] = item["stale"] or item.get("database_signature") != database_signature(db_path(payload, settings))
        return item


def _query(payload, emit, *, more):
    settings = {**load_settings_for_payload(payload), **payload}
    with open_reviews(payload, settings) as store:
        requested = payload.get("paths") or [payload.get("path")]
        items = [store.get(path) for path in requested if path]
        failures = 0
        for index, item in enumerate(items):
            if CONTROL.is_cancelled():
                break
            original_revision = item["revision"]
            current = snapshot(item["path"], item.get("excludes", []), item.get("max_depth"))
            if current["unavailable"]:
                store.save({**item, "unavailable": True}, original_revision)
                continue
            # Changed files invalidate old evidence, but retain queried IDs for the lifetime budget.
            previous = {query["pid"]: query for query in item.get("queries", [])}
            changed = current["fingerprint"] != item.get("fingerprint")
            if changed:
                previous = {pid: {**query, "status": "stale"} for pid, query in previous.items()}
            item = {**item, **current, "stale": False, "unverified": False, "error": "", "conflict": False}
            local = preview_scan_changes([Path(item["path"])], db_path(payload, settings), resolve_online=False,
                                         exclude_roots=[Path(path) for path in item.get("excludes", [])],
                                         max_depth=item.get("max_depth"), capture_review=True)
            local_item = next((row for row in local.review if row["path"] == item["path"]), {})
            item["candidates"] = local_item.get("candidates", [])
            item["conflict"] = local_item.get("conflict", False)
            item["name_hint"] = local_item.get("name_hint", "")
            item["candidates"].extend({"artist_id": query["artist_id"], "name": query["name"], "source": "online_pid"}
                                      for query in previous.values() if query["status"] == "resolved")
            if more:
                wanted = set(current["samples"]) - previous.keys()
                wanted = resolver.select_resolution_work_ids(wanted, min(5, max(0, 30 - len(previous))))
            else:
                wanted = [pid for pid, query in previous.items() if query["status"] in ("failed", "stale") and pid in current["samples"]]
                if not previous:
                    wanted = resolver.select_resolution_work_ids(set(current["samples"]), min(5, max(1, int(settings.get("resolve_limit", 3)))))
            baseline = database_signature(db_path(payload, settings))
            if not settings.get("resolve_online", True):
                wanted = []
            for pid in wanted:
                if CONTROL.is_cancelled() or failures >= 3:
                    break
                emit({"type": "progress", "key": PROGRESS_SCAN_REVIEW, "payload": {"current": index + 1, "total": len(items), "path": item["path"], "pid": pid}})
                try:
                    result = resolver.fetch_artwork_author(pid, cookie=load_cookie(), allow_insecure_ssl_fallback=bool(settings.get("ssl_fallback", True)))
                    previous[pid] = {"pid": pid, "status": "resolved" if result else "empty", "artist_id": result.id if result else "", "name": result.name if result else "", "error": ""}
                    failures = 0
                except resolver.PixivResolveError as exc:
                    previous[pid] = {"pid": pid, "status": "failed", "artist_id": "", "name": "", "error": str(exc)}
                    failures += 1
                item["queries"] = list(previous.values())
                item["candidates"] = [candidate for candidate in item.get("candidates", []) if candidate["source"] != "online_pid"]
                item["candidates"].extend({"artist_id": query["artist_id"], "name": query["name"], "source": "online_pid"}
                                          for query in previous.values() if query["status"] == "resolved")
                item["database_signature"] = baseline
                item = store.save(item, original_revision)
                original_revision = item["revision"]
                time.sleep(0.8)
            item["queries"] = list(previous.values())
            item["database_signature"] = baseline
            store.save(item, original_revision)
            if failures >= 3:
                break
    return list_items(payload, emit)


def retry(payload, emit):
    return _query(payload, emit, more=False)


def sample(payload, emit):
    return _query(payload, emit, more=True)


def apply(payload, _emit):
    settings = load_settings_for_payload(payload)
    session = ACTIVE.get()
    if session is None:
        raise ValueError("Review apply requires a recovery transaction")
    with open_reviews(payload, settings) as store, session.guard():
        item = _current(store.get(payload["path"]))
        database = db_path(payload, settings)
        if item["revision"] != payload.get("revision") or item["stale"] or item["unavailable"] or item.get("database_signature") != database_signature(database):
            raise ValueError("Review is stale or unavailable; refresh this folder before applying")
        if status_for(item) != "awaiting_confirmation":
            raise ValueError("A single confirmed candidate is required; use manual assignment for conflicts")
        candidate = item["candidates"][0]
        db = ArtistDatabase.load(database)
        proposed = {}
        _accumulate_hit(proposed, ResolvedHit(candidate["artist_id"], candidate["name"], candidate["source"],
                                            Path(item.get("root", item["path"])), Path(item["path"]), frozenset(item.get("samples", {}))))
        # Attribution never silently renames an existing artist.
        operations = [op for op in _build_diff_changes(proposed, db) if op["kind"] != "name_change"]
        result = apply_scan_changes(database, operations, unmatched_paths=[item["path"]])
        store.discard_assigned(ArtistDatabase.load(database), settings.get("exclude_roots", []))
        return {"applied": result.applied, "artists": [artist_to_json(artist) for artist in ArtistDatabase.load(database).get_many()]}
