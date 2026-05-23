"""Commands for checking and downloading new artwork updates."""

from __future__ import annotations

from pathlib import Path

from ...cookie_store import load_cookie
from ...operations import check_artist_updates, download_artist_updates
from ..payload import as_bool, as_float, as_int, db_path
from ..runtime import Emitter, JsonDict, make_progress_callback
from ..serializers import download_result_to_json, update_result_to_json
from .settings import load_settings_for_payload


def check(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    update_check_pages = as_int(payload, "update_check_pages", as_int(settings, "update_check_pages", 0))
    result = check_artist_updates(
        db_path(payload, settings),
        artist_ids=[str(item) for item in payload.get("artist_ids") or []] or None,
        pixiv_cookie=payload.get("pixiv_cookie") or load_cookie(),
        allow_insecure_ssl_fallback=as_bool(payload, "ssl_fallback", bool(settings.get("ssl_fallback", True))),
        scan_local=as_bool(payload, "scan_local_subfolders", bool(settings.get("scan_local_subfolders", False))),
        max_pages=update_check_pages if update_check_pages > 0 else None,
        progress_callback=make_progress_callback(emit_event),
    )
    return update_result_to_json(result)


def download(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    output_root = payload.get("output_root")
    result = download_artist_updates(
        db_path(payload, settings),
        artist_ids=[str(item) for item in payload.get("artist_ids") or []] or None,
        output_root=Path(output_root) if output_root else None,
        pixiv_cookie=payload.get("pixiv_cookie") or load_cookie(),
        allow_insecure_ssl_fallback=as_bool(payload, "ssl_fallback", bool(settings.get("ssl_fallback", True))),
        overwrite=as_bool(payload, "overwrite", False),
        delay_seconds=as_float(payload, "delay", 0.3),
        separate_restricted=as_bool(payload, "separate_r18", bool(settings.get("separate_r18", False))),
        progress_callback=make_progress_callback(emit_event),
    )
    return download_result_to_json(result)
