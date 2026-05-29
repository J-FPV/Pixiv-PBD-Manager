"""Payload coercion and project-root / settings-path resolution.

Every command handler takes a JSON ``payload`` and needs the same handful of
things: where the user's project root is, where to find/write the settings
JSON, where the artists DB lives, and how to read typed fields out of the
payload safely. Those helpers all live here.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from ..paths import (
    DATA_DIR,
    DATA_DIR_ENV_VAR,
    DEFAULT_DB,
    DEFAULT_GUI_SETTINGS as DEFAULT_SETTINGS_PATH,
    _appdata_root,
    write_json_atomic,
)
from .runtime import JsonDict

# ``DEFAULT_DB`` and ``DEFAULT_SETTINGS_PATH`` are re-exported from this module
# for callers that historically imported them from ``gui_api.payload``.

# Project source root (the directory containing the pixiv_pbd_manager/ package),
# used as a last-resort candidate when no project root is reachable from the
# payload-supplied path or from cwd.
#
# **Disabled when running inside a PyInstaller bundle.** In that case
# ``__file__`` lives under ``sys._MEIPASS`` — a temp directory that PyInstaller
# creates on every launch and deletes on exit. If we let resolve_base_dir pick
# it as the base, writes go to a folder that vanishes seconds later, and the
# very next IPC call sees an empty database. (Diagnosed from a "scan applied
# but artists list stays empty" report in an installed build.)
SOURCE_ROOT: Path | None = (
    None if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[2]
)


def load_json(path: Path) -> JsonDict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def save_json(path: Path, data: JsonDict) -> None:
    write_json_atomic(path, data)


def _looks_like_project_root(path: Path) -> bool:
    # Heuristic: a directory is a project root if it holds either the package
    # source tree (developer checkout) or the user-state directory (installed).
    return (path / "pixiv_pbd_manager").is_dir() or (path / DATA_DIR.name).exists()


def _nearest_project_root(path: Path) -> Path | None:
    resolved = path.expanduser().resolve()
    for candidate in (resolved, *resolved.parents):
        if _looks_like_project_root(candidate):
            return candidate
    return None


def _user_data_fallback() -> Path:
    """Return the base directory under which the legacy ``.pixiv-pbd-manager/``
    subfolder lives in end-user (installed) mode. Honours the
    ``PIXIV_PBD_DATA_DIR`` env var if set, else uses the OS-standard user data
    directory. Creates the directory tree if needed.
    """
    env = os.environ.get(DATA_DIR_ENV_VAR)
    if env:
        base = Path(env).expanduser()
    else:
        base = _appdata_root()
    base.mkdir(parents=True, exist_ok=True)
    (base / DATA_DIR.name).mkdir(parents=True, exist_ok=True)
    return base


def resolve_base_dir(project_root: Any = None) -> Path:
    """Pick the directory that GUI command handlers should chdir into.

    The Tauri frontend lives in ``desktop/src-tauri/`` and passes
    ``project_root=".."`` (or similar) expecting the resolver to **walk
    upward** until it finds a project root — a directory holding either
    ``pixiv_pbd_manager/`` (developer checkout) or ``.pixiv-pbd-manager/``
    (installed user state). That walk-up is the whole point of this
    function.

    Order of preference:
      1. The supplied ``project_root`` (or its closest ancestor that looks
         like a project root).
      2. The closest project root walking up from cwd.
      3. The OS user data directory (``%APPDATA%/PixivPbdManager/`` on
         Windows, equivalents elsewhere). Honours ``PIXIV_PBD_DATA_DIR``
         env var as an override.

    **Gotcha for tests / smokes:** if you pass ``project_root=/tmp/foo``
    and ``/tmp/foo`` has neither marker, the walk-up will escape into
    cwd and you'll silently hit the OS user data directory (which then
    persists between test runs). To isolate a smoke, ``mkdir
    <tmp>/.pixiv-pbd-manager`` before calling, or set the
    ``PIXIV_PBD_DATA_DIR`` env var.
    """
    if not project_root:
        cwd = Path.cwd().resolve()
        marker = _nearest_project_root(cwd)
        if marker:
            return marker
        return _user_data_fallback()

    raw = Path(str(project_root)).expanduser()
    candidates: list[Path] = [raw if raw.is_absolute() else Path.cwd() / raw, Path.cwd()]
    if SOURCE_ROOT is not None:
        candidates.append(SOURCE_ROOT)

    for candidate in candidates:
        root = _nearest_project_root(candidate)
        if root:
            return root
    return _user_data_fallback()


def base_dir(payload: JsonDict) -> Path:
    """Read the base dir stamped into the payload by run_command."""
    return Path(str(payload.get("_base_dir") or Path.cwd())).expanduser().resolve()


def resolve_path(path: Path | str, base: Path) -> Path:
    value = Path(path).expanduser()
    return value if value.is_absolute() else base / value


def settings_path(payload: JsonDict) -> Path:
    return resolve_path(payload.get("settings_path") or DEFAULT_SETTINGS_PATH, base_dir(payload))


def db_path(payload: JsonDict, settings: JsonDict | None = None) -> Path:
    value = payload.get("db_path") or payload.get("database") or (settings or {}).get("database") or DEFAULT_DB
    return resolve_path(value, base_dir(payload))


def paths(values: Any, base: Path | None = None) -> list[Path]:
    where = base or Path.cwd()
    return [resolve_path(str(value), where) for value in (values or []) if str(value).strip()]


def as_bool(payload: JsonDict, key: str, default: bool) -> bool:
    value = payload.get(key)
    return default if value is None else bool(value)


def as_float(payload: JsonDict, key: str, default: float) -> float:
    try:
        return float(payload.get(key, default))
    except (TypeError, ValueError):
        return default


def as_int(payload: JsonDict, key: str, default: int) -> int:
    try:
        return int(payload.get(key, default))
    except (TypeError, ValueError):
        return default
