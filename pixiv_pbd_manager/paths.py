"""Filesystem paths shared across the package.

On-disk state lives under a data directory whose location is determined in
priority order:

  1. ``PIXIV_PBD_DATA_DIR`` env var (a directory; the ``.pixiv-pbd-manager/``
     subfolder is created inside it).
  2. An existing ``.pixiv-pbd-manager/`` folder found by walking up from the
     current working directory. This keeps the developer workflow unchanged —
     ``pip install -e .`` + running from the repo finds the in-repo state dir.
  3. OS-standard user data directory:
     - Windows: ``%APPDATA%/PixivPbdManager/``
     - macOS:   ``~/Library/Application Support/PixivPbdManager/``
     - Linux:   ``$XDG_DATA_HOME/PixivPbdManager/`` or ``~/.local/share/PixivPbdManager/``

The relative ``DATA_DIR`` / ``DEFAULT_DB`` / … constants below are still
exported and used as fallbacks by the gui_api command handlers; resolution
against the chosen base directory happens in ``gui_api.payload.resolve_path``.

Each individual feature module re-exports the constants it owns from here
under its historic names (``database.DEFAULT_DB``, ``consent.CONSENT_PATH``,
…), so external callers and tests keep working unchanged.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


LEGACY_DATA_DIR_NAME = ".pixiv-pbd-manager"
APP_FOLDER_NAME = "PixivPbdManager"
DATA_DIR_ENV_VAR = "PIXIV_PBD_DATA_DIR"


def _appdata_root() -> Path:
    """OS-standard per-user app data directory for this app (NOT created)."""
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or os.path.expanduser("~/AppData/Roaming")
    elif sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    return Path(base) / APP_FOLDER_NAME


def _find_legacy_data_dir(start: Path) -> Path | None:
    """Walk up from ``start`` looking for an existing legacy ``.pixiv-pbd-manager/`` folder.

    Returns the legacy directory if found, else ``None``. Symlink-aware (works on
    the resolved path). Quietly returns ``None`` on any resolve error.
    """
    try:
        current = start.expanduser().resolve()
    except (OSError, RuntimeError):
        return None
    for candidate in (current, *current.parents):
        legacy = candidate / LEGACY_DATA_DIR_NAME
        if legacy.is_dir():
            return legacy
    return None


def resolve_data_dir(start: Path | None = None) -> Path:
    """Return the absolute path to the data directory using the resolution order
    documented at the top of this module. Does NOT create the directory."""
    env = os.environ.get(DATA_DIR_ENV_VAR)
    if env:
        return Path(env).expanduser() / LEGACY_DATA_DIR_NAME
    legacy = _find_legacy_data_dir(start or Path.cwd())
    if legacy:
        return legacy
    return _appdata_root() / LEGACY_DATA_DIR_NAME


# Legacy relative-path constants. Still used as defaults by gui_api command
# handlers; resolved against the GUI base directory by ``resolve_path``.
DATA_DIR = Path(LEGACY_DATA_DIR_NAME)

DEFAULT_DB = DATA_DIR / "artists.json"
DEFAULT_IMAGE_INDEX = DATA_DIR / "image_index.json"
DEFAULT_GUI_SETTINGS = DATA_DIR / "gui_settings.json"
DEFAULT_CONSENT = DATA_DIR / "consent.json"
DEFAULT_COOKIE_BIN = DATA_DIR / "cookie.bin"
DEFAULT_COOKIE_TXT = DATA_DIR / "cookie.txt"
