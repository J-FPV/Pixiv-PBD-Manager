"""Build the PyInstaller backend bundle and place it where Tauri can find it.

The spec is in ``--onedir`` mode so the output is a *folder* (the exe plus an
``_internal/`` directory with the Python runtime). We copy that whole folder
into ``desktop/src-tauri/binaries/pixiv-pbd-api/`` — Tauri's release config
bundles it via ``bundle.resources`` and the frontend resolves the resource
path at runtime instead of going through the sidecar mechanism (which only
handles single-file binaries).

Run from the repo root:

    python scripts/build_sidecar.py

After this, ``cd desktop && npm run tauri:build`` produces an installer that
ships the bundled Python backend.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SPEC = REPO_ROOT / "pixiv-pbd-api.spec"
DIST_DIR = REPO_ROOT / "dist" / "pixiv-pbd-api"
LAUNCHER_NAME = "pixiv-pbd-api.exe" if sys.platform == "win32" else "pixiv-pbd-api"
BIN_DIR = REPO_ROOT / "desktop" / "src-tauri" / "binaries"


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

    launcher = DIST_DIR / LAUNCHER_NAME
    if not launcher.exists():
        print(f"FAIL: expected launcher at {launcher}", file=sys.stderr)
        return 1
    internal = DIST_DIR / "_internal"
    if not internal.is_dir():
        print(f"FAIL: expected _internal/ next to launcher at {internal}", file=sys.stderr)
        return 1

    target = BIN_DIR / "pixiv-pbd-api"
    if target.exists():
        shutil.rmtree(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(DIST_DIR, target)

    total_bytes = sum(p.stat().st_size for p in target.rglob("*") if p.is_file())
    total_files = sum(1 for p in target.rglob("*") if p.is_file())
    size_mb = total_bytes / (1024 * 1024)
    print(f"\nOK: sidecar placed at {target} ({total_files} files, {size_mb:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
