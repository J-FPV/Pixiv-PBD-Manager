"""Build the PyInstaller backend exe and place it at the Tauri sidecar path.

Tauri expects sidecars to be named ``<bundle-name>-<target-triple>``, so we
detect the Rust target triple via ``rustc -vV`` and copy ``dist/pixiv-pbd-api(.exe)``
into ``desktop/src-tauri/binaries/`` with the proper suffix.

Run from the repo root:

    python scripts/build_sidecar.py

After this, ``cd desktop && npm run tauri:build`` produces an installer that
includes the bundled Python backend.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SPEC = REPO_ROOT / "pixiv-pbd-api.spec"
DIST_EXE = REPO_ROOT / "dist" / ("pixiv-pbd-api.exe" if sys.platform == "win32" else "pixiv-pbd-api")
BIN_DIR = REPO_ROOT / "desktop" / "src-tauri" / "binaries"


def rustc_target_triple() -> str:
    """Return the Rust host target triple (e.g. ``x86_64-pc-windows-msvc``).

    Tauri's externalBin mechanism appends this exact string to the bundle
    name, so we must match what Rust thinks the host is — not what Python
    reports about itself.
    """
    proc = subprocess.run(["rustc", "-vV"], capture_output=True, text=True, check=True)
    for line in proc.stdout.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()
    raise RuntimeError("rustc -vV did not report a host triple")


def main() -> int:
    if not SPEC.exists():
        print(f"FAIL: spec file missing at {SPEC}", file=sys.stderr)
        return 1

    print(f"=== pyinstaller {SPEC.name} ===", flush=True)
    rc = subprocess.run(
        [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", str(SPEC)],
        cwd=REPO_ROOT,
    ).returncode
    if rc != 0:
        return rc
    if not DIST_EXE.exists():
        print(f"FAIL: expected built exe at {DIST_EXE}", file=sys.stderr)
        return 1

    triple = rustc_target_triple()
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    suffix = ".exe" if sys.platform == "win32" else ""
    target = BIN_DIR / f"pixiv-pbd-api-{triple}{suffix}"
    shutil.copy2(DIST_EXE, target)
    size_mb = target.stat().st_size / (1024 * 1024)
    print(f"\nOK: sidecar placed at {target} ({size_mb:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
