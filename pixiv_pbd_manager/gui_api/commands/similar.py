"""Command for visual-similarity scan across the library."""

from __future__ import annotations

from ...similar import find_similar_images
from ..payload import as_bool, base_dir, paths
from ..runtime import Emitter, JsonDict, make_progress_callback
from ..serializers import similar_result_to_json
from .settings import load_settings_for_payload


def run(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    base = base_dir(payload)
    roots = paths(payload.get("roots") or settings.get("download_roots"), base)
    raw_exclude_roots = payload.get("exclude_roots") if "exclude_roots" in payload else settings.get("exclude_roots")
    exclude_roots = paths(raw_exclude_roots, base)
    result = find_similar_images(
        roots,
        exclude_roots=exclude_roots,
        threshold=str(payload.get("threshold") or settings.get("similar_threshold") or "likely"),
        skip_same_pixiv_work_pages=as_bool(
            payload,
            "similar_skip_pixiv_pages",
            bool(settings.get("similar_skip_pixiv_pages", False)),
        ),
        progress_callback=make_progress_callback(emit_event),
    )
    return similar_result_to_json(result)
