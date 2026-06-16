"""Commands that open external resources: browser tabs, file explorer, thumbnails."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional

from ...browser import open_urls
from ...database import ArtistDatabase
from ...scanner import is_relative_to
from ..payload import as_float, as_int, db_path
from ..runtime import Emitter, JsonDict
from ..thumbnails import image_difference as render_difference
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


def _windows_open_folder(path: Path) -> None:
    _windows_shell_execute(str(path))


def _windows_shell_execute(file: str, parameters: Optional[str] = None) -> None:
    import ctypes

    result = ctypes.windll.shell32.ShellExecuteW(None, "open", file, parameters, None, 1)
    if result <= 32:
        raise OSError(f"ShellExecuteW failed for {file}: code {result}")


def _windows_reveal_file(path: Path) -> None:
    _windows_shell_execute("explorer.exe", f'/select,"{path}"')


def _nearest_existing_parent(path: Path) -> Path | None:
    current = path.parent
    while current != current.parent:
        if current.exists():
            return current
        current = current.parent
    return current if current.exists() else None


def reveal_file(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    path_text = str(payload.get("path") or "").strip()
    if not path_text:
        raise ValueError("Missing path")
    path = Path(path_text).expanduser().resolve()
    selected = False
    if path.is_dir():
        # Open the folder's contents directly.
        if os.name == "nt":
            _windows_open_folder(path)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path)])
    elif path.is_file():
        # Reveal a file by selecting it inside its parent folder.
        if os.name == "nt":
            try:
                _windows_reveal_file(path)
                selected = True
            except OSError:
                _windows_open_folder(path.parent)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", str(path)])
            selected = True
        else:
            subprocess.Popen(["xdg-open", str(path.parent)])
    else:
        parent = _nearest_existing_parent(path)
        if parent is None:
            raise ValueError(f"Path does not exist: {path}")
        if os.name == "nt":
            _windows_open_folder(parent)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(parent)])
        else:
            subprocess.Popen(["xdg-open", str(parent)])
    return {"path": str(path), "opened": True, "selected": selected}


def image_thumbnail(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    path_text = str(payload.get("path") or "").strip()
    if not path_text:
        raise ValueError("Missing path")
    target_width = max(0, min(1600, as_int(payload, "target_width", 0)))
    max_size_limit = 12000 if target_width else 1600
    max_size = max(48, min(max_size_limit, as_int(payload, "max_size", 180)))
    max_pixels = max(0, min(12_000_000, as_int(payload, "max_pixels", 0)))
    path = Path(path_text).expanduser()
    if not path.is_file():
        raise ValueError(f"Image file does not exist: {path}")
    data_url, width, height = render_thumbnail(
        path,
        max_size,
        target_width=target_width or None,
        max_pixels=max_pixels or None,
    )
    return {
        "path": str(path),
        "data_url": data_url,
        "width": width,
        "height": height,
    }


def image_difference(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    base_text = str(payload.get("base_path") or "").strip()
    compare_text = str(payload.get("compare_path") or "").strip()
    if not base_text or not compare_text:
        raise ValueError("Missing image path")
    max_size = max(48, min(1600, as_int(payload, "max_size", 1200)))
    base_path = Path(base_text).expanduser()
    compare_path = Path(compare_text).expanduser()
    if not base_path.is_file():
        raise ValueError(f"Image file does not exist: {base_path}")
    if not compare_path.is_file():
        raise ValueError(f"Image file does not exist: {compare_path}")
    data_url, width, height = render_difference(base_path, compare_path, max_size)
    return {
        "base_path": str(base_path),
        "compare_path": str(compare_path),
        "data_url": data_url,
        "width": width,
        "height": height,
    }
