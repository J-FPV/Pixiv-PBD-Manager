"""Image-library health diagnostics exposed to the desktop GUI."""

from __future__ import annotations

from ...doctor import run_library_doctor
from ...library import library_index_status
from ...paths import DEFAULT_LIBRARY_INDEX
from ..payload import base_dir, db_path, paths, resolve_path
from ..runtime import Emitter, JsonDict
from .settings import load_settings_for_payload


def run(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    base = base_dir(payload)
    roots = paths(payload.get("download_roots") or settings.get("download_roots"), base)
    excludes = paths(payload.get("exclude_roots") or settings.get("exclude_roots"), base)
    index_path = resolve_path(payload.get("library_index") or DEFAULT_LIBRARY_INDEX, base)
    return run_library_doctor(
        database_path=db_path(payload, settings),
        download_roots=roots,
        user_data_dir=str(payload.get("user_data_dir") or settings.get("user_data_dir") or ""),
        quarantine_dir=str(payload.get("quarantine_dir") or settings.get("quarantine_dir") or ""),
        index_status=library_index_status(index_path, roots, excludes),
    )
