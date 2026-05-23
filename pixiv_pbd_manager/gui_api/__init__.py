"""JSON-Lines IPC entry point invoked by the Tauri desktop frontend.

The frontend spawns ``python -m pixiv_pbd_manager.gui_api <cmd> <json>`` once
per command and reads JSON-encoded events line by line from stdout. This
module is the dispatcher: it routes ``<cmd>`` to a handler in
``gui_api.commands.*`` and wraps any exception into a structured
``{"type":"error",...}`` event so the frontend never sees an empty pipe.

See ``runtime.py`` for the emitter / pause-gate / control-reader plumbing and
``payload.py`` for the path/coercion helpers each handler relies on.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from typing import Callable

from .commands import artists, files, scan, settings, similar, updates
from .payload import resolve_base_dir
from .runtime import Emitter, JsonDict, emit_event, start_control_reader


COMMANDS: dict[str, Callable[[JsonDict, Emitter], JsonDict]] = {
    "settings.get": settings.get,
    "settings.save": settings.save,
    "cookie.revoke": settings.revoke_cookie,
    "artists.list": artists.list_artists,
    "artists.add": artists.add_artist,
    "artists.assign_folder": artists.assign_folder,
    "artists.remove": artists.remove_artists,
    "artists.rename": artists.rename_artist,
    "artists.set_save_path": artists.set_save_path,
    "scan.run": scan.run,
    "scan.preview": scan.preview,
    "scan.apply": scan.apply,
    "updates.check": updates.check,
    "updates.download": updates.download,
    "similar.run": similar.run,
    "browser.open": files.open_browser,
    "file.reveal": files.reveal_file,
    "image.thumbnail": files.image_thumbnail,
}


def run_command(command: str, payload: JsonDict | None = None, *, emit: Emitter = emit_event) -> int:
    payload = dict(payload or {})
    base_dir = resolve_base_dir(payload.get("project_root"))
    payload["_base_dir"] = str(base_dir)
    os.chdir(base_dir)

    handler = COMMANDS.get(command)
    if not handler:
        emit({"type": "error", "command": command, "message": f"Unknown GUI API command: {command}"})
        return 2

    try:
        result = handler(payload, emit)
    except Exception as exc:  # noqa: BLE001 -- this is the top-level handler boundary
        emit(
            {
                "type": "error",
                "command": command,
                "message": str(exc),
                "traceback": traceback.format_exc(),
            }
        )
        return 1
    emit({"type": "result", "command": command, "payload": result})
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        emit_event({"type": "error", "message": "Missing GUI API command"})
        return 2
    command = argv[0]
    if len(argv) >= 2:
        try:
            payload = json.loads(argv[1])
        except json.JSONDecodeError as exc:
            emit_event({"type": "error", "command": command, "message": f"Invalid JSON payload: {exc}"})
            return 2
    else:
        payload = {}
    if not isinstance(payload, dict):
        emit_event({"type": "error", "command": command, "message": "Payload must be a JSON object"})
        return 2
    start_control_reader(emit_event)
    return run_command(command, payload)


__all__ = ["COMMANDS", "main", "run_command", "emit_event"]
