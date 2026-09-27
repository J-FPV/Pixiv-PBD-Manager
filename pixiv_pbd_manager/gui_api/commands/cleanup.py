"""Commands for quarantining, restoring, and deleting duplicate images."""

from __future__ import annotations

from pathlib import Path
from functools import wraps

from ...cleanup import (
    cleanup_summary,
    delete_quarantined_files,
    ignore_group,
    quarantine_files,
    restore_files,
    unignore_group,
)
from ...paths import DEFAULT_CLEANUP_STATE, DEFAULT_IMAGE_INDEX
from ...library.annotations import annotated_catalog, cleanup_annotation_move
from ...library.catalog import library_index_metadata_path, save_library_index
from ..payload import base_dir, paths, resolve_path
from ..runtime import CONTROL, Emitter, JsonDict, make_progress_callback
from .settings import load_settings_for_payload
from .library import _index_path as _library_index_path


def _with_annotations(command):
    @wraps(command)
    def run(payload, emit_event):
        index = _library_index_path(payload)
        with annotated_catalog(index) as (store, _catalog):
            callback = lambda item, state: cleanup_annotation_move(store, item, state)
            result = command({**payload, "_annotation_callback": callback}, emit_event)
            if result.get("moved_paths"):
                # Reload so a concurrent scan's physical metadata is not reverted.
                with annotated_catalog(index) as (_fresh_store, fresh):
                    removed = set(result["moved_paths"])
                    save_library_index([image for image in fresh.values() if image.path not in removed],
                                       index, annotation_store_id=store.store_id)
            if result.get("restored_paths"):
                library_index_metadata_path(index).unlink(missing_ok=True)
            return result
    return run


def _state_path(payload: JsonDict) -> Path:
    return resolve_path(payload.get("cleanup_state_path") or DEFAULT_CLEANUP_STATE, base_dir(payload))


def _index_path(payload: JsonDict) -> Path:
    return resolve_path(payload.get("index_path") or DEFAULT_IMAGE_INDEX, base_dir(payload))


@_with_annotations
def list_cleanup(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    return cleanup_summary(_state_path(payload), annotation_callback=payload["_annotation_callback"])


@_with_annotations
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
        annotation_callback=payload["_annotation_callback"],
    )


@_with_annotations
def restore(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    return restore_files(
        str(payload.get("operation_id") or ""),
        item_ids=[str(value) for value in payload.get("item_ids") or []],
        state_path=_state_path(payload),
        index_path=_index_path(payload),
        progress_callback=make_progress_callback(emit_event),
        should_cancel=CONTROL.is_cancelled,
        annotation_callback=payload["_annotation_callback"],
    )


@_with_annotations
def delete(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    return delete_quarantined_files(
        str(payload.get("operation_id") or ""),
        item_ids=[str(value) for value in payload.get("item_ids") or []],
        state_path=_state_path(payload),
        progress_callback=make_progress_callback(emit_event),
        should_cancel=CONTROL.is_cancelled,
        annotation_callback=payload["_annotation_callback"],
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
