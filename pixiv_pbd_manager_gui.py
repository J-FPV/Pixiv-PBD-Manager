"""Entry script for the standalone GUI executable.

When run as a PyInstaller bundle (``sys.frozen`` is True), this script changes
the working directory to the folder that holds the .exe so that
``.pixiv-pbd-manager/`` (artists.json, cookie.bin, consent.json, gui_settings.json)
lives next to the executable regardless of how the user launched it.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def main() -> int:
    if getattr(sys, "frozen", False):
        os.chdir(Path(sys.executable).resolve().parent)
    from pixiv_pbd_manager.gui import main as gui_main

    return gui_main()


if __name__ == "__main__":
    raise SystemExit(main())
