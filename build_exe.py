"""Build a single-file Windows .exe for the Pixiv PBD Manager GUI.

Usage:
    python build_exe.py

Output:
    dist/PixivPbdManager.exe

Requires project build dependencies (``pip install -e .[build]``).
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ENTRY = ROOT / "pixiv_pbd_manager_gui.py"
APP_NAME = "PixivPbdManager"


def clean() -> None:
    for path in (ROOT / "build", ROOT / "dist", ROOT / f"{APP_NAME}.spec"):
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()


def main() -> int:
    if not ENTRY.exists():
        print(f"Entry script not found: {ENTRY}", file=sys.stderr)
        return 2
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print(
            "PyInstaller is not installed. Install the project build dependencies:\n"
            "    pip install -e .[build]",
            file=sys.stderr,
        )
        return 2

    clean()

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--windowed",
        "--name",
        APP_NAME,
        str(ENTRY),
    ]
    print("Running:", " ".join(cmd))
    return subprocess.call(cmd)


if __name__ == "__main__":
    raise SystemExit(main())
