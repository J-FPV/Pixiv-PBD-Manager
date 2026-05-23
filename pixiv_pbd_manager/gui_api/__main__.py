# Allows `python -m pixiv_pbd_manager.gui_api <cmd> <json>`. The Tauri desktop
# frontend spawns subprocesses this way; converting the module into a package
# requires this file so the same -m invocation keeps working.

from . import main


if __name__ == "__main__":
    raise SystemExit(main())
