"""Commands that read/write individual artist records.

Note on the patch surface: anywhere these helpers need ``fetch_user_profile``
we import the ``resolver`` *module* and look the attribute up at call time
(``resolver.fetch_user_profile(...)``), so tests can patch
``pixiv_pbd_manager.resolver.fetch_user_profile`` to intercept the call.
"""

from __future__ import annotations

from ... import resolver
from ...cookie_store import load_cookie
from ...database import ArtistDatabase
from ...events import (
    PROGRESS_REFRESH_NAMES_ARTIST,
    PROGRESS_REFRESH_NAMES_DONE,
    PROGRESS_REFRESH_NAMES_START,
)
from ...operations import collect_local_work_ids, rebuild_artist_work_index
from ..payload import base_dir, db_path, paths, resolve_path
from ..runtime import CONTROL, Emitter, JsonDict, make_progress_callback
from ..serializers import artist_to_json
from .settings import load_settings_for_payload


def _resolve_artist_name_if_missing(artist_id: str, name: str | None, settings: JsonDict) -> str | None:
    if name:
        return name
    try:
        profile = resolver.fetch_user_profile(
            artist_id,
            cookie=load_cookie(),
            allow_insecure_ssl_fallback=bool(settings.get("ssl_fallback", True)),
        )
    except resolver.PixivResolveError:
        return None
    return profile.name if profile.name and profile.name != artist_id else None


def _artists_and_tags(db: ArtistDatabase) -> JsonDict:
    """Shared payload for commands that touch tags: the full artist list plus the
    ordered tag-definition list, so the frontend can refresh both at once."""
    return {
        "artists": [artist_to_json(artist) for artist in db.get_many()],
        "tags": list(db.defined_tags),
    }


def list_artists(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    db = ArtistDatabase.load(db_path(payload, settings))
    return {
        **_artists_and_tags(db),
        "db_path": str(db.path),
        "project_root": str(base_dir(payload)),
    }


def add_artist(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    artist_id = str(payload.get("artist_id") or "").strip()
    if not artist_id.isdigit():
        raise ValueError("Artist id must be digits")
    name = str(payload.get("name") or "").strip() or None
    save_path = str(payload.get("save_path") or "").strip() or None
    name = _resolve_artist_name_if_missing(artist_id, name, settings)
    db = ArtistDatabase.load(db_path(payload, settings))
    changed = db.upsert(artist_id, name=name, source="manual", save_path=save_path)
    db.save()
    return {"artist_id": artist_id, "changed": changed, "name": name or "", "save_path": save_path or ""}


def assign_folder(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    artist_id = str(payload.get("artist_id") or "").strip()
    if not artist_id.isdigit():
        raise ValueError("Artist id must be digits")
    folder_text = str(payload.get("folder") or payload.get("save_path") or "").strip()
    if not folder_text:
        raise ValueError("Missing folder")
    folder = resolve_path(folder_text, base_dir(payload)).resolve()
    if not folder.is_dir():
        raise ValueError(f"Folder does not exist: {folder}")

    name = _resolve_artist_name_if_missing(artist_id, str(payload.get("name") or "").strip() or None, settings)
    work_ids = collect_local_work_ids([str(folder)])
    db = ArtistDatabase.load(db_path(payload, settings))
    changed = db.upsert(
        artist_id,
        name=name,
        source=f"manual_unmatched_folder:{folder}",
        save_path=folder,
        work_ids=work_ids,
    )
    db.save()
    return {
        "artist_id": artist_id,
        "changed": changed,
        "name": name or "",
        "save_path": str(folder),
        "work_ids": len(work_ids),
    }


def remove_artists(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    artist_ids = [str(item).strip() for item in payload.get("artist_ids") or [] if str(item).strip()]
    db = ArtistDatabase.load(db_path(payload, settings))
    removed = db.remove_many(artist_ids)
    if removed:
        db.save()
    return {"removed": len(removed), "artist_ids": removed}


def refresh_names(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    db = ArtistDatabase.load(db_path(payload, settings))
    requested_ids = [str(item).strip() for item in payload.get("artist_ids") or [] if str(item).strip()]
    target_ids = requested_ids or sorted(db.artists, key=lambda value: (len(value), value))
    target_ids = [artist_id for artist_id in target_ids if artist_id in db.artists]
    cookie = load_cookie()
    allow_ssl_fallback = bool(settings.get("ssl_fallback", True))
    changed = 0
    refreshed: list[JsonDict] = []
    errors: list[str] = []

    emit_event({"type": "progress", "key": PROGRESS_REFRESH_NAMES_START, "payload": {"total": len(target_ids)}})
    for index, artist_id in enumerate(target_ids, 1):
        artist = db.artists[artist_id]
        emit_event(
            {
                "type": "progress",
                "key": PROGRESS_REFRESH_NAMES_ARTIST,
                "payload": {
                    "current": index,
                    "total": len(target_ids),
                    "artist_id": artist_id,
                    "artist": artist.name or artist_id,
                },
            }
        )
        try:
            profile = resolver.fetch_user_profile(
                artist_id,
                cookie=cookie,
                allow_insecure_ssl_fallback=allow_ssl_fallback,
            )
        except resolver.PixivResolveError as exc:
            errors.append(f"{artist_id}: {exc}")
            continue

        new_name = (profile.name or "").strip()
        if not new_name or new_name == artist_id:
            continue
        old_name = artist.name or ""
        name_changed = new_name != old_name
        if name_changed:
            artist.name = new_name
            source = "name_refreshed:pixiv_profile"
            if source not in artist.sources:
                artist.sources.append(source)
            changed += 1
        refreshed.append({"artist_id": artist_id, "old_name": old_name, "name": new_name, "changed": name_changed})

    if changed:
        db.save()
    emit_event(
        {
            "type": "progress",
            "key": PROGRESS_REFRESH_NAMES_DONE,
            "payload": {"total": len(target_ids), "changed": changed, "failed": len(errors)},
        }
    )
    return {
        "requested": len(requested_ids),
        "checked": len(target_ids),
        "changed": changed,
        "failed": len(errors),
        "errors": errors,
        "refreshed": refreshed,
        "artists": [artist_to_json(artist) for artist in db.get_many()],
    }


def _work_index_result_payload(result) -> JsonDict:
    return {
        "artists_total": result.artists_total,
        "artists_scanned": result.artists_scanned,
        "artists_skipped": result.artists_skipped,
        "artists_changed": result.artists_changed,
        "files_seen": result.files_seen,
        "old_ids": result.old_ids,
        "new_ids": result.new_ids,
        "added_ids": result.added_ids,
        "removed_ids": result.removed_ids,
        "pending_ids_cleared": result.pending_ids_cleared,
        "conflicting_ids": list(result.conflicting_ids),
        "missing_paths": list(result.missing_paths),
        "cancelled": result.cancelled,
        "applied": result.applied,
        "db_path": str(result.db_path or ""),
        "backup_path": str(result.backup_path or ""),
        "changes": [
            {
                "artist_id": change.artist_id,
                "name": change.name,
                "files_seen": change.files_seen,
                "old_count": change.old_count,
                "new_count": change.new_count,
                "added_ids": list(change.added_ids),
                "removed_ids": list(change.removed_ids),
            }
            for change in result.changes
        ],
    }


def preview_work_index(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    excludes = paths(payload.get("exclude_roots") or settings.get("exclude_roots"), base_dir(payload))
    result = rebuild_artist_work_index(
        db_path(payload, settings),
        exclude_roots=excludes,
        progress_callback=make_progress_callback(emit_event),
        is_cancelled=CONTROL.is_cancelled,
        wait_if_paused=CONTROL.wait_if_paused,
    )
    return _work_index_result_payload(result)


def apply_work_index(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    resolved_db_path = db_path(payload, settings)
    excludes = paths(payload.get("exclude_roots") or settings.get("exclude_roots"), base_dir(payload))
    result = rebuild_artist_work_index(
        resolved_db_path,
        apply=True,
        exclude_roots=excludes,
        progress_callback=make_progress_callback(emit_event),
        is_cancelled=CONTROL.is_cancelled,
        wait_if_paused=CONTROL.wait_if_paused,
    )
    db = ArtistDatabase.load(resolved_db_path)
    return {
        **_work_index_result_payload(result),
        "artists": [artist_to_json(artist) for artist in db.get_many()],
    }


def rename_artist(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    old_id = str(payload.get("old_id") or "").strip()
    new_id = str(payload.get("new_id") or "").strip()
    if not new_id.isdigit():
        raise ValueError("Artist id must be digits")
    db = ArtistDatabase.load(db_path(payload, settings))
    changed = db.rename_artist_id(old_id, new_id)
    name = ""
    if new_id in db.artists:
        try:
            profile = resolver.fetch_user_profile(
                new_id,
                cookie=load_cookie(),
                allow_insecure_ssl_fallback=bool(settings.get("ssl_fallback", True)),
            )
            if profile.name and profile.name != new_id:
                db.artists[new_id].name = profile.name
                name = profile.name
        except resolver.PixivResolveError:
            pass
    db.save()
    return {"old_id": old_id, "new_id": new_id, "changed": changed, "name": name}


def set_save_path(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    artist_id = str(payload.get("artist_id") or "").strip()
    save_path = str(payload.get("save_path") or "").strip()
    if not save_path:
        raise ValueError("Missing save path")
    db = ArtistDatabase.load(db_path(payload, settings))
    changed = db.set_artist_save_path(artist_id, save_path)
    db.save()
    return {"artist_id": artist_id, "changed": changed, "save_path": save_path}


def set_favorite(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    artist_id = str(payload.get("artist_id") or "").strip()
    favorite = bool(payload.get("favorite"))
    db = ArtistDatabase.load(db_path(payload, settings))
    changed = db.set_artist_favorite(artist_id, favorite)
    if changed:
        db.save()
    return {"artist_id": artist_id, "changed": changed, "favorite": favorite}


def set_tags(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    artist_id = str(payload.get("artist_id") or "").strip()
    tags = [str(item) for item in payload.get("tags") or []]
    db = ArtistDatabase.load(db_path(payload, settings))
    changed = db.set_artist_tags(artist_id, tags)
    if changed:
        db.save()
    return {"artist_id": artist_id, "changed": changed, "tags": sorted(set(db.artists[artist_id].tags))}


def add_tag(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    db = ArtistDatabase.load(db_path(payload, settings))
    changed = db.add_tag(str(payload.get("name") or ""))
    if changed:
        db.save()
    return {"changed": changed, "tags": list(db.defined_tags)}


def assign_tag(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    artist_ids = [str(item).strip() for item in payload.get("artist_ids") or [] if str(item).strip()]
    db = ArtistDatabase.load(db_path(payload, settings))
    assigned = db.assign_tag(artist_ids, str(payload.get("name") or ""))
    db.save()
    return {"assigned": assigned, **_artists_and_tags(db)}


def rename_tag(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    db = ArtistDatabase.load(db_path(payload, settings))
    changed = db.rename_tag(str(payload.get("old") or ""), str(payload.get("new") or ""))
    if changed:
        db.save()
    return {"changed": changed, **_artists_and_tags(db)}


def delete_tag(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    db = ArtistDatabase.load(db_path(payload, settings))
    changed = db.delete_tag(str(payload.get("name") or ""))
    if changed:
        db.save()
    return {"changed": changed, **_artists_and_tags(db)}
