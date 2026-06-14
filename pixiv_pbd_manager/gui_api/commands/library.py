"""Commands backing the Image Library browser: build the catalog, list it
(joined with live artist data), and edit per-image tags."""

from __future__ import annotations

import time
from pathlib import Path

from ... import resolver
from ...cookie_store import load_cookie
from ...database import ArtistDatabase
from ...events import (
    PROGRESS_FETCH_TAGS_DONE,
    PROGRESS_FETCH_TAGS_ITEM,
    PROGRESS_FETCH_TAGS_START,
)
from ...library import (
    build_catalog,
    build_pid_to_artist,
    load_library_index,
    save_library_index,
)
from ...paths import DEFAULT_LIBRARY_INDEX
from ..payload import as_bool, as_float, base_dir, db_path, paths, resolve_path
from ..runtime import CONTROL, Emitter, JsonDict, make_progress_callback
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


def fetch_tags(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    """Fetch each artwork's Pixiv tags (original + English translation) and store
    them on every catalog image sharing that PID. Operates on the paths in the
    payload (a single image or the filtered set); rate-limited and cancellable."""
    settings = load_settings_for_payload(payload)
    index_path = _index_path(payload)
    catalog = load_library_index(index_path)
    requested = {
        str(Path(item).expanduser().resolve())
        for item in (payload.get("paths") or [])
        if str(item).strip()
    }
    targets = [image for image in catalog.values() if not requested or image.path in requested]

    pid_to_images: dict[str, list] = {}
    for image in targets:
        if image.pid:
            pid_to_images.setdefault(image.pid, []).append(image)
    pids = list(pid_to_images)

    cookie = payload.get("pixiv_cookie") or load_cookie()
    allow_ssl = as_bool(payload, "ssl_fallback", bool(settings.get("ssl_fallback", True)))
    delay = as_float(payload, "resolve_delay", 0.8)
    progress = make_progress_callback(emit_event)
    progress(PROGRESS_FETCH_TAGS_START, {"total": len(pids)})

    errors: list[str] = []
    updated = 0
    cancelled = False
    for index, pid in enumerate(pids, 1):
        if CONTROL.is_cancelled():
            cancelled = True
            break
        try:
            tags, _ssl_used = resolver.fetch_artwork_tags(pid, cookie=cookie, allow_insecure_ssl_fallback=allow_ssl)
            pixiv_tags = [{"tag": tag.tag, "translation": tag.translation} for tag in tags]
            for image in pid_to_images[pid]:
                image.pixiv_tags = [dict(item) for item in pixiv_tags]
            updated += 1
        except resolver.PixivResolveError as exc:
            errors.append(f"{pid}: {exc}")
        progress(PROGRESS_FETCH_TAGS_ITEM, {"current": index, "total": len(pids), "pid": pid, "errors": len(errors)})
        if delay > 0 and index < len(pids):
            time.sleep(delay)

    save_library_index(catalog.values(), index_path)
    progress(PROGRESS_FETCH_TAGS_DONE, {"total": len(pids), "updated": updated, "errors": len(errors)})

    db = ArtistDatabase.load(db_path(payload, settings))
    rows = [
        library_image_to_json(image, db.artists.get(image.artist_id) if image.artist_id else None)
        for image in targets
    ]
    return {"images": rows, "errors": errors, "cancelled": cancelled}
