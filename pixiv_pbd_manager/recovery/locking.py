"""Short, reentrant cross-process locks, released by the OS after a crash."""

from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import tempfile
import threading
import time

_local = threading.local()
_mutex = threading.RLock()


@contextmanager
def data_lock(paths):
    keys = sorted({hashlib.sha256(os.path.normcase(str(Path(p).resolve())).encode()).hexdigest() for p in paths})
    with _mutex:
        held = getattr(_local, "held", {})
        _local.held = held
        acquired = []
        try:
            for key in keys:
                if key in held:
                    continue
                directory = Path(tempfile.gettempdir()) / "pixiv-pbd-locks"
                directory.mkdir(exist_ok=True)
                stream = (directory / key).open("a+b")
                stream.seek(0, 2)
                if not stream.tell():
                    stream.write(b"0")
                    stream.flush()
                deadline = time.monotonic() + 15
                while True:
                    try:
                        stream.seek(0)
                        if os.name == "nt":
                            import msvcrt
                            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                        else:
                            import fcntl
                            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        break
                    except OSError:
                        if time.monotonic() >= deadline:
                            stream.close()
                            raise RuntimeError("Data is busy; wait for the current write to finish") from None
                        time.sleep(0.05)
                held[key] = stream
                acquired.append(key)
            yield
        finally:
            for key in reversed(acquired):
                held.pop(key).close()
