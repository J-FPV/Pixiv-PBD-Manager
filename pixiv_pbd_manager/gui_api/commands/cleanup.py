"""Commands for quarantining, restoring, and deleting duplicate images."""

from __future__ import annotations

from pathlib import Path

from ...cleanup import (
    cleanup_summary,
    delete_quarantined_files,
    ignore_group,
    quarantine_files,
    restore_files,
    unignore_group,
)
from ...paths import DEFAULT_CLEANUP_STATE, DEFAULT_IMAGE_INDEX
from ..payload import base_dir, paths, resolve_path
from ..runtime import CONTROL, Emitter, JsonDict, make_progress_callback
from .settings import load_settings_for_payload


def _state_path(payload: JsonDict) -> Path:
    return resolve_path(payload.get("cleanup_state_path") or DEFAULT_CLEANUP_STATE, base_dir(payload))


def _index_path(payload: JsonDict) -> Path:
    return resolve_path(payload.get("index_path") or DEFAULT_IMAGE_INDEX, base_dir(payload))


def list_cleanup(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    return cleanup_summary(_state_path(payload))


def quarantine(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    quarantine_text = str(payload.get("quarantine_dir") or settings.get("quarantine_dir") or "").strip()
    if not quarantine_text:
        raise ValueError("Choose a quarantine folder before cleaning duplicate images")
    protected = paths(payload.get("scan_roots") or [], base_dir(payload))
    protected.extend(paths(payload.get("download_roots") or settings.get("download_roots") or [], base_dir(payload)))
    raw_items = [item for item in payload.get("items") or [] if isinstance(item, dict)]
    return quarantine_files(
        raw_items,
        quarantine_root=resolve_path(quarantine_text, base_dir(payload)),
        protected_roots=protected,
        state_path=_state_path(payload),
        index_path=_index_path(payload),
        progress_callback=make_progress_callback(emit_event),
        should_cancel=CONTROL.is_cancelled,
    )


def restore(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    return restore_files(
        str(payload.get("operation_id") or ""),
        item_ids=[str(value) for value in payload.get("item_ids") or []],
        state_path=_state_path(payload),
        index_path=_index_path(payload),
        progress_callback=make_progress_callback(emit_event),
        should_cancel=CONTROL.is_cancelled,
    )


def delete(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    return delete_quarantined_files(
        str(payload.get("operation_id") or ""),
        item_ids=[str(value) for value in payload.get("item_ids") or []],
        state_path=_state_path(payload),
        progress_callback=make_progress_callback(emit_event),
        should_cancel=CONTROL.is_cancelled,
    )


def ignore(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    return ignore_group(
        str(payload.get("signature") or ""),
        kind=str(payload.get("kind") or ""),
        entry_count=int(payload.get("entry_count") or 0),
        state_path=_state_path(payload),
    )


def unignore(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    return unignore_group(
        str(payload.get("signature") or ""),
        state_path=_state_path(payload),
    )
