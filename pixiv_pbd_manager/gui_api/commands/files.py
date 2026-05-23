"""Commands that open external resources: browser tabs, file explorer, thumbnails."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from ...browser import open_urls
from ...database import ArtistDatabase
from ...scanner import is_relative_to
from ..payload import as_float, as_int, db_path
from ..runtime import Emitter, JsonDict
from ..thumbnails import image_thumbnail as render_thumbnail
from .settings import load_settings_for_payload


def _is_unsafe_user_data_dir(user_data_dir: Any, download_roots: Any) -> bool:
    if not user_data_dir:
        return False
    target = Path(str(user_data_dir)).expanduser().resolve()
    for raw in download_roots or []:
        if not str(raw).strip():
            continue
        root = Path(str(raw)).expanduser().resolve()
        if target == root or is_relative_to(target, root):
            return True
    return False


def open_browser(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = load_settings_for_payload(payload)
    user_data_dir = payload.get("user_data_dir") or settings.get("user_data_dir") or None
    download_roots = payload.get("download_roots") or settings.get("download_roots") or []
    if _is_unsafe_user_data_dir(user_data_dir, download_roots):
        raise ValueError("Browser user data folder cannot be inside a download folder")
    urls = [str(item) for item in payload.get("urls") or []]
    artist_ids = [str(item) for item in payload.get("artist_ids") or []]
    if artist_ids:
        db = ArtistDatabase.load(db_path(payload, settings))
        urls.extend(artist.pixiv_url for artist in db.get_many(artist_ids))
    open_urls(
        urls,
        browser=payload.get("browser") or settings.get("browser") or None,
        user_data_dir=user_data_dir,
        delay_seconds=as_float(payload, "delay", float(settings.get("delay", 1.0))),
    )
    return {"opened": len(urls)}


def reveal_file(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    path_text = str(payload.get("path") or "").strip()
    if not path_text:
        raise ValueError("Missing path")
    path = Path(path_text).expanduser()
    if path.is_dir():
        # Open the folder's contents directly.
        if os.name == "nt":
            subprocess.Popen(["explorer", str(path)])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path)])
    else:
        # Reveal a file by selecting it inside its parent folder.
        if os.name == "nt":
            subprocess.Popen(["explorer", "/select,", str(path)])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path.parent)])
    return {"path": str(path), "opened": True}


def image_thumbnail(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    path_text = str(payload.get("path") or "").strip()
    if not path_text:
        raise ValueError("Missing path")
    max_size = max(48, min(1600, as_int(payload, "max_size", 180)))
    path = Path(path_text).expanduser()
    if not path.is_file():
        raise ValueError(f"Image file does not exist: {path}")
    data_url, width, height = render_thumbnail(path, max_size)
    return {
        "path": str(path),
        "data_url": data_url,
        "width": width,
        "height": height,
    }
