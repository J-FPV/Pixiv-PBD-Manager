"""Background annotation protection and explicit recovery IPC commands."""

from ...events import PROGRESS_ANNOTATIONS
from ...library.annotation_identity import protect
from ...library.annotations import annotated_catalog, recovery_list, relink
from ..runtime import CONTROL, make_progress_callback
from ..serializers import library_image_to_json
from .library import _index_path, _scan_paths
from .settings import load_settings_for_payload


def protect_annotations(payload, emit_event):
    settings = load_settings_for_payload(payload)
    roots, _ = _scan_paths(payload, settings)
    callback = make_progress_callback(emit_event)
    with annotated_catalog(_index_path(payload)) as (store, _catalog):
        return protect(store, roots, retry=bool(payload.get("retry")), should_cancel=CONTROL.is_cancelled,
                       progress=lambda done, total: callback(PROGRESS_ANNOTATIONS, {"done": done, "total": total}))


def unlinked(payload, _emit_event):
    with annotated_catalog(_index_path(payload)) as (store, catalog):
        return recovery_list(store, catalog, str(payload.get("query") or ""), int(payload.get("page") or 1))


def relink_annotations(payload, _emit_event):
    with annotated_catalog(_index_path(payload)) as (store, catalog):
        target = next((image for image in catalog.values() if image.image_id == payload.get("target_id")), None)
        if not target:
            raise ValueError("Target image is no longer in the library; scan and try again")
        result = relink(store, str(payload.get("image_id") or ""), target,
                        int(payload.get("annotation_revision") or 0),
                        confirm_unverified=bool(payload.get("confirm_unverified")),
                        confirmed_sha256=str(payload.get("confirmed_sha256") or ""))
        if not result["confirmation_required"]:
            result["image"] = library_image_to_json(target)
        return result
