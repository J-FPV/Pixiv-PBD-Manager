"""Commands backing the Image Library browser: build the catalog, list it
(joined with live artist data), and edit per-image tags."""

from __future__ import annotations

import csv
import time
from datetime import datetime
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
    build_save_path_index,
    library_index_status,
    load_library_index,
    resolve_folder_artist,
    save_library_index,
    save_library_index_metadata,
)
from ...paths import DEFAULT_LIBRARY_INDEX
from ..payload import as_bool, as_float, base_dir, db_path, paths, resolve_path
from ..runtime import CONTROL, Emitter, JsonDict, make_progress_callback
from ..serializers import library_image_to_json
from .settings import load_settings_for_payload


def _index_path(payload: JsonDict) -> Path:
    return resolve_path(payload.get("library_index") or DEFAULT_LIBRARY_INDEX, base_dir(payload))


def _scan_paths(payload: JsonDict, settings: JsonDict) -> tuple[list[Path], list[Path]]:
    base = base_dir(payload)
    roots = paths(payload.get("roots") or payload.get("download_roots") or settings.get("download_roots"), base)
    excludes = paths(payload.get("exclude_roots") or settings.get("exclude_roots"), base)
    return roots, excludes


def index_status(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    roots, exclude_roots = _scan_paths(payload, settings)
    return library_index_status(_index_path(payload), roots, exclude_roots)


def _artist_lookup(db: ArtistDatabase):
    pid_map = build_pid_to_artist(db)
    save_index = build_save_path_index(db)
    folder_cache: dict[str, str] = {}

    def find(image):
        artist_id = folder_cache.get(image.folder)
        if artist_id is None:
            artist_id = resolve_folder_artist(image.folder, save_index)
            folder_cache[image.folder] = artist_id
        if not artist_id and image.pid:
            artist_id = pid_map.get(image.pid, "")
        return db.artists.get(artist_id) if artist_id else None

    return find


def list_images(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    db = ArtistDatabase.load(db_path(payload, settings))
    index_path = _index_path(payload)
    catalog = load_library_index(index_path)
    images = sorted(catalog.values(), key=lambda image: image.mtime_ns, reverse=True)

    # Attribute each image to an artist live: the folder it lives under wins (so
    # works filed under an artist's folder inherit the artist + its tags even
    # when their PID isn't in that artist's online work-id list), then the PID
    # mapping. Folder resolution is cached per unique folder.
    artist_for = _artist_lookup(db)
    rows = [library_image_to_json(image, artist_for(image)) for image in images]
    roots, exclude_roots = _scan_paths(payload, settings)
    return {
        "images": rows,
        "needs_scan": not catalog,
        "index_status": library_index_status(index_path, roots, exclude_roots),
        "db_path": str(db.path),
    }


def scan(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    roots, exclude_roots = _scan_paths(payload, settings)
    index_path = _index_path(payload)
    db = ArtistDatabase.load(db_path(payload, settings))
    images, summary = build_catalog(
        roots,
        exclude_roots,
        pid_to_artist=build_pid_to_artist(db),
        save_path_index=build_save_path_index(db),
        old_catalog=load_library_index(index_path),
        progress_callback=make_progress_callback(emit_event),
    )
    save_library_index(images, index_path)
    save_library_index_metadata(index_path, roots, exclude_roots, entry_count=len(images))
    return {
        "files_seen": summary.files_seen,
        "indexed": summary.indexed,
        "reused": summary.reused,
        "changed": summary.changed,
        "errors": summary.error_count,
        "error_examples": list(summary.errors[:20]),
        "needs_scan": not images,
        "index_status": library_index_status(index_path, roots, exclude_roots),
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
    artist = _artist_lookup(db)(image)
    return {"image": library_image_to_json(image, artist)}


def update_metadata(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    """Apply one metadata patch to many catalog images and persist once."""
    settings = load_settings_for_payload(payload)
    index_path = _index_path(payload)
    catalog = load_library_index(index_path)
    requested: list[str] = []
    for item in payload.get("paths") or []:
        if not str(item).strip():
            continue
        requested.append(str(Path(item).expanduser().resolve()))
    if not requested:
        raise ValueError("Choose at least one image")

    add_tags = {str(tag).strip() for tag in payload.get("add_tags") or [] if str(tag).strip()}
    remove_tags = {str(tag).strip() for tag in payload.get("remove_tags") or [] if str(tag).strip()}
    copy_pixiv_tags = as_bool(payload, "copy_pixiv_tags", False)
    set_favorite = "favorite" in payload
    set_rating = "rating" in payload
    set_markers = "markers" in payload
    rating = max(0, min(5, int(payload.get("rating") or 0)))
    allowed_markers = {"high_value", "used", "to_sort"}
    markers = sorted({str(value) for value in payload.get("markers") or [] if str(value) in allowed_markers})
    add_markers = {str(value) for value in payload.get("add_markers") or [] if str(value) in allowed_markers}
    remove_markers = {str(value) for value in payload.get("remove_markers") or [] if str(value) in allowed_markers}

    changed = []
    for path_text in requested:
        image = catalog.get(path_text)
        if image is None:
            continue
        if set_favorite:
            image.favorite = as_bool(payload, "favorite", False)
        if set_rating:
            image.rating = rating
        if set_markers:
            image.markers = list(markers)
        elif add_markers or remove_markers:
            marker_set = set(image.markers)
            marker_set.update(add_markers)
            marker_set.difference_update(remove_markers)
            image.markers = sorted(marker_set)
        tags = set(image.tags)
        tags.update(add_tags)
        tags.difference_update(remove_tags)
        if copy_pixiv_tags:
            tags.update(str(item.get("tag") or "").strip() for item in image.pixiv_tags if item.get("tag"))
        image.tags = sorted(tag for tag in tags if tag)
        changed.append(image)

    if changed:
        save_library_index(catalog.values(), index_path)
    db = ArtistDatabase.load(db_path(payload, settings))
    artist_for = _artist_lookup(db)
    return {
        "updated": len(changed),
        "images": [library_image_to_json(image, artist_for(image)) for image in changed],
    }


def export_list(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    """Export selected/filtered catalog rows as an Excel-friendly UTF-8 CSV."""
    settings = load_settings_for_payload(payload)
    output_text = str(payload.get("output") or "").strip()
    if not output_text:
        raise ValueError("Missing export path")
    output = resolve_path(output_text, base_dir(payload))
    if output.suffix.lower() != ".csv":
        output = output.with_suffix(".csv")
    output.parent.mkdir(parents=True, exist_ok=True)

    catalog = load_library_index(_index_path(payload))
    targets = []
    seen: set[str] = set()
    for item in payload.get("paths") or []:
        path_text = str(Path(item).expanduser().resolve())
        image = catalog.get(path_text)
        if image is not None and path_text not in seen:
            seen.add(path_text)
            targets.append(image)
    db = ArtistDatabase.load(db_path(payload, settings))
    artist_for = _artist_lookup(db)
    with output.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow([
            "path", "filename", "artist_id", "artist_name", "pixiv_id", "page", "favorite", "rating",
            "markers", "local_tags", "pixiv_tags", "width", "height", "format", "size_bytes", "modified",
        ])
        for image in targets:
            artist = artist_for(image)
            writer.writerow([
                image.path,
                Path(image.path).name,
                artist.id if artist else image.artist_id,
                (artist.name or "") if artist else "",
                image.pid,
                "" if image.page is None else image.page,
                "1" if image.favorite else "0",
                image.rating,
                "; ".join(image.markers),
                "; ".join(image.tags),
                "; ".join(str(item.get("tag") or "") for item in image.pixiv_tags if item.get("tag")),
                image.width,
                image.height,
                image.format,
                image.size_bytes,
                datetime.fromtimestamp(image.mtime_ns / 1_000_000_000).astimezone().isoformat() if image.mtime_ns else "",
            ])
    return {"output": str(output), "exported": len(targets)}


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
