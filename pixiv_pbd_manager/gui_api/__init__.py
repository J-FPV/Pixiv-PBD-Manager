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
from pathlib import Path
from typing import Callable

from .commands import app_info, artists, cleanup, doctor, files, library, scan, settings, similar, updates
from .payload import resolve_base_dir
from .runtime import CONTROL, Emitter, JsonDict, emit_event, start_control_reader


COMMANDS: dict[str, Callable[[JsonDict, Emitter], JsonDict]] = {
    "settings.get": settings.get,
    "settings.save": settings.save,
    "cookie.revoke": settings.revoke_cookie,
    "artists.list": artists.list_artists,
    "artists.add": artists.add_artist,
    "artists.assign_folder": artists.assign_folder,
    "artists.remove": artists.remove_artists,
    "artists.refresh_names": artists.refresh_names,
    "artists.rebuild_work_index.preview": artists.preview_work_index,
    "artists.rebuild_work_index.apply": artists.apply_work_index,
    "artists.rename": artists.rename_artist,
    "artists.set_save_path": artists.set_save_path,
    "artists.set_favorite": artists.set_favorite,
    "artists.set_tags": artists.set_tags,
    "artists.add_tag": artists.add_tag,
    "artists.assign_tag": artists.assign_tag,
    "artists.rename_tag": artists.rename_tag,
    "artists.delete_tag": artists.delete_tag,
    "scan.run": scan.run,
    "scan.preview": scan.preview,
    "scan.apply": scan.apply,
    "updates.check": updates.check,
    "updates.download": updates.download,
    "similar.run": similar.run,
    "library.list": library.list_images,
    "library.status": library.index_status,
    "library.scan": library.scan,
    "library.set_tags": library.set_tags,
    "library.update_metadata": library.update_metadata,
    "library.export": library.export_list,
    "library.fetch_tags": library.fetch_tags,
    "cleanup.list": cleanup.list_cleanup,
    "cleanup.quarantine": cleanup.quarantine,
    "cleanup.restore": cleanup.restore,
    "cleanup.delete": cleanup.delete,
    "cleanup.ignore": cleanup.ignore,
    "cleanup.unignore": cleanup.unignore,
    "doctor.run": doctor.run,
    "app.latest_release": app_info.latest_release,
    "browser.open": files.open_browser,
    "file.reveal": files.reveal_file,
    "image.thumbnail": files.image_thumbnail,
    "image.difference": files.image_difference,
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


def _read_payload_source(command: str, argv: list[str]) -> tuple[str, int]:
    """Return (payload_text, exit_code). exit_code != 0 means error already emitted.

    Supports three forms (Tauri only uses the first):
      <cmd> '<json>'                 — JSON as a single positional arg
      <cmd> --payload-file PATH      — read JSON from a file
      <cmd> -                        — read JSON from stdin

    The latter two exist so a human at a PowerShell prompt can hand-debug a
    command without fighting argv quoting (PowerShell strips inner double
    quotes from a JSON arg).
    """
    if not argv:
        return "{}", 0
    first = argv[0]
    if first == "-":
        # ``readline`` (not ``read``) so the same stdin stream can carry
        # subsequent ``{"control":"pause"}`` / ``{"control":"resume"}`` lines
        # for the control reader. Frontend writes one compact JSON line +
        # newline as the payload, then keeps stdin open for control messages.
        return sys.stdin.readline(), 0
    if first == "--payload-file":
        if len(argv) < 2:
            emit_event({"type": "error", "command": command, "message": "--payload-file requires a path"})
            return "", 2
        try:
            # ``utf-8-sig`` strips an optional BOM. PowerShell 5.1's
            # ``Out-File -Encoding utf8`` writes a BOM by default; plain UTF-8
            # files without a BOM also decode correctly under this codec.
            return Path(argv[1]).read_text(encoding="utf-8-sig"), 0
        except OSError as exc:
            emit_event({"type": "error", "command": command, "message": f"Cannot read payload file: {exc}"})
            return "", 2
    return first, 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        emit_event({"type": "error", "message": "Missing GUI API command"})
        return 2
    command = argv[0]
    payload_text, rc = _read_payload_source(command, argv[1:])
    if rc != 0:
        return rc
    try:
        payload = json.loads(payload_text) if payload_text.strip() else {}
    except json.JSONDecodeError as exc:
        emit_event({"type": "error", "command": command, "message": f"Invalid JSON payload: {exc}"})
        return 2
    if not isinstance(payload, dict):
        emit_event({"type": "error", "command": command, "message": "Payload must be a JSON object"})
        return 2
    CONTROL.reset()
    start_control_reader(emit_event)
    return run_command(command, payload)


__all__ = ["COMMANDS", "main", "run_command", "emit_event"]
