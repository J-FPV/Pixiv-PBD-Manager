"""Commands for full scan, dry-run scan preview, and apply selected changes."""

from __future__ import annotations

from ...cookie_store import load_cookie
from ...operations import apply_scan_changes, preview_scan_changes, scan_into_database
from ..payload import as_bool, as_float, as_int, base_dir, db_path, paths
from ..runtime import Emitter, JsonDict, make_progress_callback
from ..serializers import scan_result_to_json
from .settings import load_settings_for_payload


def run(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    base = base_dir(payload)
    roots = paths(payload.get("roots") or settings.get("download_roots"), base)
    exclude_roots = paths(payload.get("exclude_roots") or settings.get("exclude_roots"), base)
    result = scan_into_database(
        roots,
        db_path(payload, settings),
        resolve_online=as_bool(payload, "resolve_online", bool(settings.get("resolve_online", True))),
        resolve_limit=as_int(payload, "resolve_limit", int(settings.get("resolve_limit", 3))),
        resolve_delay=as_float(payload, "resolve_delay", 0.8),
        pixiv_cookie=payload.get("pixiv_cookie") or load_cookie(),
        allow_insecure_ssl_fallback=as_bool(payload, "ssl_fallback", bool(settings.get("ssl_fallback", True))),
        exclude_roots=exclude_roots,
        fuzzy_search_names=as_bool(payload, "fuzzy_search", bool(settings.get("fuzzy_search", False))),
        fuzzy_min_score=as_float(payload, "fuzzy_min_score", float(settings.get("fuzzy_min_score", 0.35))),
        progress_callback=make_progress_callback(emit_event),
    )
    return scan_result_to_json(result)


def preview(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    base = base_dir(payload)
    roots = paths(payload.get("roots") or settings.get("download_roots"), base)
    exclude_roots = paths(payload.get("exclude_roots") or settings.get("exclude_roots"), base)
    result = preview_scan_changes(
        roots,
        db_path(payload, settings),
        resolve_online=as_bool(payload, "resolve_online", bool(settings.get("resolve_online", True))),
        resolve_limit=as_int(payload, "resolve_limit", int(settings.get("resolve_limit", 3))),
        resolve_delay=as_float(payload, "resolve_delay", 0.8),
        pixiv_cookie=payload.get("pixiv_cookie") or load_cookie(),
        allow_insecure_ssl_fallback=as_bool(payload, "ssl_fallback", bool(settings.get("ssl_fallback", True))),
        exclude_roots=exclude_roots,
        fuzzy_search_names=as_bool(payload, "fuzzy_search", bool(settings.get("fuzzy_search", False))),
        fuzzy_min_score=as_float(payload, "fuzzy_min_score", float(settings.get("fuzzy_min_score", 0.35))),
        progress_callback=make_progress_callback(emit_event),
    )
    summary = result.summary
    unmatched: list[dict] = []
    if summary is not None:
        unmatched_sorted = sorted(summary.unmatched_folders.items(), key=lambda item: (-item[1], item[0]))
        unmatched = [{"path": path, "count": count} for path, count in unmatched_sorted]
    return {
        "changes": result.changes,
        "files_seen": summary.files_seen if summary else 0,
        "files_matched": summary.files_matched if summary else 0,
        "excluded_dirs": summary.excluded_dirs if summary else 0,
        "artists": len(summary.artists) if summary else 0,
        "name_only_artists": len(summary.name_only_artists) if summary else 0,
        "resolved_name_only": result.resolved_name_only,
        "fuzzy_resolved_name_only": result.fuzzy_resolved_name_only,
        "ssl_fallback_used": result.ssl_fallback_used,
        "resolve_errors": list(result.resolve_errors),
        "unmatched_folders": unmatched,
    }


def apply(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    operations = payload.get("operations")
    if not isinstance(operations, list):
        raise ValueError("operations must be a list")
    result = apply_scan_changes(db_path(payload, settings), [op for op in operations if isinstance(op, dict)])
    return {
        "applied": result.applied,
        "new_artists": result.new_artists,
        "name_changes": result.name_changes,
        "save_paths_added": result.save_paths_added,
        "work_ids_added": result.work_ids_added,
        "db_path": str(result.db_path) if result.db_path else "",
    }
