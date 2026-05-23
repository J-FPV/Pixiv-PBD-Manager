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
from ...operations import collect_local_work_ids
from ..payload import base_dir, db_path, resolve_path
from ..runtime import Emitter, JsonDict
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


def list_artists(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    db = ArtistDatabase.load(db_path(payload, settings))
    return {
        "artists": [artist_to_json(artist) for artist in db.get_many()],
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
