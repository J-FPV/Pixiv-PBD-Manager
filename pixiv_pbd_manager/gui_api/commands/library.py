"""Commands backing the Image Library browser: build the catalog, list it
(joined with live artist data), and edit per-image tags."""

from __future__ import annotations

from pathlib import Path

from ...database import ArtistDatabase
from ...library import (
    build_catalog,
    build_pid_to_artist,
    load_library_index,
    save_library_index,
)
from ...paths import DEFAULT_LIBRARY_INDEX
from ..payload import base_dir, db_path, paths, resolve_path
from ..runtime import Emitter, JsonDict, make_progress_callback
from ..serializers import library_image_to_json
from .settings import load_settings_for_payload


def _index_path(payload: JsonDict) -> Path:
    return resolve_path(payload.get("library_index") or DEFAULT_LIBRARY_INDEX, base_dir(payload))


def list_images(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    db = ArtistDatabase.load(db_path(payload, settings))
    catalog = load_library_index(_index_path(payload))
    images = sorted(catalog.values(), key=lambda image: image.mtime_ns, reverse=True)
    rows = [
        library_image_to_json(image, db.artists.get(image.artist_id) if image.artist_id else None)
        for image in images
    ]
    return {"images": rows, "needs_scan": not catalog, "db_path": str(db.path)}


def scan(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    base = base_dir(payload)
    roots = paths(payload.get("roots") or settings.get("download_roots"), base)
    exclude_roots = paths(payload.get("exclude_roots") or settings.get("exclude_roots"), base)
    index_path = _index_path(payload)
    db = ArtistDatabase.load(db_path(payload, settings))
    images, summary = build_catalog(
        roots,
        exclude_roots,
        pid_to_artist=build_pid_to_artist(db),
        old_catalog=load_library_index(index_path),
        progress_callback=make_progress_callback(emit_event),
    )
    save_library_index(images, index_path)
    return {
        "files_seen": summary.files_seen,
        "indexed": summary.indexed,
        "reused": summary.reused,
        "changed": summary.changed,
        "errors": summary.error_count,
        "error_examples": list(summary.errors[:20]),
        "needs_scan": not images,
    }


def set_tags(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    path_text = str(payload.get("path") or "").strip()
    if not path_text:
        raise ValueError("Missing path")
    index_path = _index_path(payload)
    catalog = load_library_index(index_path)
    key = str(Path(path_text).expanduser().resolve())
    image = catalog.get(key) or catalog.get(path_text)
    if image is None:
        raise ValueError(f"Image not in library catalog: {path_text}")
    image.tags = sorted({str(tag).strip() for tag in payload.get("tags") or [] if str(tag).strip()})
    save_library_index(catalog.values(), index_path)
    db = ArtistDatabase.load(db_path(payload, settings))
    artist = db.artists.get(image.artist_id) if image.artist_id else None
    return {"image": library_image_to_json(image, artist)}
