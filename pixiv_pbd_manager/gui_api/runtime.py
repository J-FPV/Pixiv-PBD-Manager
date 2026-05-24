"""Process-wide runtime for the GUI JSON-Lines IPC.

The frontend spawns ``python -m pixiv_pbd_manager.gui_api <cmd> <json-payload>``
once per command. This module owns the long-running pieces that have to be
shared inside that process:

* the stdout emitter (with a lock so concurrent threads don't interleave lines)
* the pause/resume control reader that watches stdin for control messages
* a small ``TaskControl`` gate that long-running operations block on

These are deliberately module-level globals: a single Python process serves a
single GUI command and is then torn down, so there is no contention with other
"sessions" — just with other threads inside this one process.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from typing import Any, Callable

from ..events import PROGRESS_DOWNLOAD_FILE_PROGRESS


JsonDict = dict[str, Any]
Emitter = Callable[[JsonDict], None]


class TaskControl:
    """Pause gate driven by stdin control messages from the frontend.

    The frontend writes ``{"control":"pause"}`` / ``{"control":"resume"}`` JSON
    lines to the subprocess stdin; a reader thread toggles this gate. Long
    loops block on it at progress checkpoints so a paused task stops issuing
    new work without holding open downloads.
    """

    def __init__(self) -> None:
        self._resume = threading.Event()
        self._resume.set()

    def pause(self) -> None:
        self._resume.clear()

    def resume(self) -> None:
        self._resume.set()

    def wait_if_paused(self) -> None:
        self._resume.wait()


CONTROL = TaskControl()
_EMIT_LOCK = threading.Lock()


def emit_event(event: JsonDict) -> None:
    """Write one JSON line to stdout, lock-protected so threads don't interleave.

    Uses ``errors='backslashreplace'`` on the final UTF-8 encode so lone
    surrogates that occasionally surface from Windows path APIs (the
    ``\\udc81`` "surrogates not allowed" crash users hit during scans) get
    serialised as the literal text ``\\udc81`` rather than aborting the IPC.
    """
    line = json.dumps(event, ensure_ascii=False) + "\n"
    data = line.encode("utf-8", errors="backslashreplace")
    with _EMIT_LOCK:
        buffer = getattr(sys.stdout, "buffer", None)
        if buffer is not None:
            buffer.write(data)
            buffer.flush()
        else:
            sys.stdout.write(line)
            sys.stdout.flush()


def _handle_control_line(raw: bytes, emit: Emitter) -> None:
    try:
        message = json.loads(raw.decode("utf-8", errors="replace").strip() or "{}")
    except ValueError:
        return
    if not isinstance(message, dict):
        return
    action = message.get("control")
    if action == "pause":
        CONTROL.pause()
        emit({"type": "control", "state": "paused"})
    elif action == "resume":
        CONTROL.resume()
        emit({"type": "control", "state": "running"})


def start_control_reader(emit: Emitter) -> None:
    """Spawn a daemon thread that turns stdin lines into CONTROL state changes.

    We read the raw stdin fd via ``os.read`` rather than ``sys.stdin.buffer``: a
    daemon thread blocked inside a BufferedReader holds its lock, which makes
    interpreter shutdown abort with ``_enter_buffered_busy``. ``os.read``
    touches no Python IO buffer, so the thread can be abandoned cleanly when
    the process exits.
    """
    try:
        fd = sys.stdin.fileno()
    except (AttributeError, OSError, ValueError):
        return

    if os.name == "nt":
        try:
            import ctypes
            import msvcrt

            handle = msvcrt.get_osfhandle(fd)
            kernel32 = ctypes.windll.kernel32
        except (ImportError, OSError, ValueError, AttributeError):
            return

        def reader_windows() -> None:
            pending = b""
            available = ctypes.c_ulong()
            while True:
                ok = kernel32.PeekNamedPipe(
                    ctypes.c_void_p(handle),
                    None,
                    0,
                    None,
                    ctypes.byref(available),
                    None,
                )
                if not ok:
                    return
                if available.value == 0:
                    time.sleep(0.05)
                    continue
                try:
                    chunk = os.read(fd, min(4096, available.value))
                except OSError:
                    return
                if not chunk:
                    return
                pending += chunk
                while b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    _handle_control_line(line, emit)

        threading.Thread(target=reader_windows, daemon=True).start()
        return

    def reader() -> None:
        pending = b""
        while True:
            try:
                chunk = os.read(fd, 4096)
            except OSError:
                return
            if not chunk:
                return
            pending += chunk
            while b"\n" in pending:
                line, pending = pending.split(b"\n", 1)
                _handle_control_line(line, emit)

    threading.Thread(target=reader, daemon=True).start()


def make_progress_callback(emit: Emitter) -> Callable[[str, dict[str, object]], None]:
    """Build the progress callback that operations.* and similar.* feed events to.

    The callback emits a ``progress`` event and also blocks here while paused,
    but **never mid-file** (would hold a CDN connection open); the
    high-frequency per-chunk key is exempt from the pause check.
    """

    def callback(key: str, payload: dict[str, object]) -> None:
        # The per-chunk download event fires many times per second while a CDN
        # stream is in flight; blocking it would keep that remote connection
        # open after the user pressed Pause. Every other key (including the
        # one-shot file_start/file_done events) goes through the gate.
        if key != PROGRESS_DOWNLOAD_FILE_PROGRESS:
            CONTROL.wait_if_paused()
        emit({"type": "progress", "key": key, "payload": payload})

    return callback
