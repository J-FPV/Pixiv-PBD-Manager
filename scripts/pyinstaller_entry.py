"""Entry point for the PyInstaller-bundled ``pixiv-pbd-api`` binary.

The Tauri desktop frontend currently spawns the backend via
``python -m pixiv_pbd_manager.gui_api ...``. Once this binary is wired
up as a Tauri sidecar, the frontend will spawn ``pixiv-pbd-api(.exe)``
directly — same JSON-Lines IPC, no Python interpreter required on the
end user's machine.

This file is the only entry point PyInstaller knows about. The actual
dispatcher lives in ``pixiv_pbd_manager.gui_api.main``.
"""

from pixiv_pbd_manager.gui_api import main


if __name__ == "__main__":
    raise SystemExit(main())
