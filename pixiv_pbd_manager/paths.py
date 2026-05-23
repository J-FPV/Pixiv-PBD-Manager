"""Filesystem paths shared across the package.

All on-disk state lives under ``DATA_DIR`` (a relative path interpreted against
the project root that ``gui_api`` resolves at startup, or against CWD when
called from the CLI). Centralising the literals here means a future move
(e.g. to ``%APPDATA%`` / ``$XDG_DATA_HOME``) only edits this one module.

Each individual feature module re-exports the constants it owns from here
under its historic names (``database.DEFAULT_DB``, ``consent.CONSENT_PATH``,
…), so external callers and tests keep working unchanged.
"""

from __future__ import annotations

from pathlib import Path


DATA_DIR = Path(".pixiv-pbd-manager")

DEFAULT_DB = DATA_DIR / "artists.json"
DEFAULT_IMAGE_INDEX = DATA_DIR / "image_index.json"
DEFAULT_GUI_SETTINGS = DATA_DIR / "gui_settings.json"
DEFAULT_CONSENT = DATA_DIR / "consent.json"
DEFAULT_COOKIE_BIN = DATA_DIR / "cookie.bin"
DEFAULT_COOKIE_TXT = DATA_DIR / "cookie.txt"
