"""Smoke-test driver for pixiv-pbd-manager.

Drives the four layers a PR usually touches:

  1. Python tests             — `pytest tests`             (--no-tests / --only tests)
  2. JSON IPC                 — `gui_api.run_command` in-process against a
                                synthetic fixture; this is what the Tauri
                                frontend invokes via subprocess.              (--no-ipc / --only ipc)
  3. Lint                     — `ruff check` + `npm run lint`                 (--no-lint / --only lint)
  4. Desktop frontend build   — `npm run build` in `desktop/`                 (--no-build / --only build)

In-process IPC avoids Windows argv quoting (PowerShell strips the inner
double quotes from a JSON argument). The frontend uses subprocess; we get
the same code path without the shell layer.

Usage from the repo root:

  python scripts/smoke.py
  python scripts/smoke.py --no-build
  python scripts/smoke.py --only ipc

Exit code is 0 only when every requested phase passes.

This is the script that CI runs and that `.claude/skills/run-pixiv-pbd-manager/`
points at for agent-driven verification.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def _section(title: str) -> None:
    print(f"\n=== {title} ===", flush=True)


def run_tests() -> bool:
    _section("pytest")
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "tests"],
        cwd=REPO_ROOT,
    )
    return proc.returncode == 0


def run_ipc_smoke() -> bool:
    _section("ipc smoke (scan.run)")
    # Late import so --no-* flags don't pay the cost.
    from pixiv_pbd_manager import gui_api

    fixture = Path(tempfile.mkdtemp(prefix="pbd-smoke-"))
    try:
        artist_dir = fixture / "pixiv" / "Smoke Artist-99999"
        artist_dir.mkdir(parents=True)
        (artist_dir / "12345_p0.jpg").write_bytes(b"")

        events: list[dict] = []

        def emit(event: dict) -> None:
            events.append(event)

        rc = gui_api.run_command(
            "scan.run",
            {
                "project_root": str(fixture),
                "roots": [str(fixture / "pixiv")],
                "db_path": str(fixture / "artists.json"),
                "resolve_online": False,
                "fuzzy_search_names": False,
                "exclude_roots": [],
                "separate_r18": False,
            },
            emit=emit,
        )
        if rc != 0:
            print(f"FAIL: run_command exit {rc}")
            for event in events:
                print(json.dumps(event))
            return False

        result_event = next((e for e in events if e.get("type") == "result"), None)
        if not result_event:
            print("FAIL: no result event emitted")
            return False
        payload = result_event["payload"]
        if payload.get("artists") != 1 or payload.get("files_matched") != 1:
            print(f"FAIL: expected 1 artist + 1 file, got {payload}")
            return False

        db_path = Path(payload["db_path"])
        if not db_path.exists():
            print(f"FAIL: artist db not written at {db_path}")
            return False
        db = json.loads(db_path.read_text(encoding="utf-8"))
        if "99999" not in db.get("artists", {}):
            print(f"FAIL: artist 99999 missing from db: {db}")
            return False

        print(f"OK: scanned 1 artist, db at {db_path}")
        return True
    finally:
        shutil.rmtree(fixture, ignore_errors=True)


def run_settings_get_smoke() -> bool:
    """settings.get against an empty fixture must not touch the real .pixiv-pbd-manager."""
    _section("ipc smoke (settings.get)")
    from pixiv_pbd_manager import gui_api

    fixture = Path(tempfile.mkdtemp(prefix="pbd-settings-"))
    # `.pixiv-pbd-manager/` marker is required for resolve_base_dir to honour
    # project_root — otherwise it walks up and finds the repo root instead.
    (fixture / ".pixiv-pbd-manager").mkdir()
    try:
        events: list[dict] = []
        rc = gui_api.run_command(
            "settings.get",
            {"project_root": str(fixture)},
            emit=events.append,
        )
        if rc != 0:
            print(f"FAIL: settings.get exit {rc}")
            return False
        result = next((e for e in events if e.get("type") == "result"), None)
        if not result:
            print("FAIL: no result event")
            return False
        if "settings" not in result["payload"]:
            print(f"FAIL: payload missing 'settings': {result}")
            return False
        # Catch the project_root isolation regression: if base_dir resolution
        # walks up out of the fixture, settings_path will land in the repo's
        # real .pixiv-pbd-manager/ — which would also leak the user's settings.
        settings_path = Path(result["payload"]["settings_path"]).resolve()
        if fixture.resolve() not in settings_path.parents:
            print(f"FAIL: settings_path escaped fixture: {settings_path}")
            return False
        print(f"OK: settings.get isolated to {fixture}")
        return True
    finally:
        shutil.rmtree(fixture, ignore_errors=True)


def run_lint() -> bool:
    _section("lint (ruff + eslint)")
    ruff = subprocess.run(
        [sys.executable, "-m", "ruff", "check", "pixiv_pbd_manager", "tests"],
        cwd=REPO_ROOT,
    )
    if ruff.returncode != 0:
        return False
    desktop = REPO_ROOT / "desktop"
    if not (desktop / "node_modules").exists():
        print("node_modules missing; skipping eslint (run `npm install` in desktop/ first)")
        return True
    eslint = subprocess.run(["npm", "run", "lint"], cwd=desktop, shell=True)
    return eslint.returncode == 0


def run_build() -> bool:
    _section("desktop build (npm run build)")
    desktop = REPO_ROOT / "desktop"
    if not (desktop / "node_modules").exists():
        print("node_modules missing; running `npm install` first…")
        install = subprocess.run(["npm", "install"], cwd=desktop, shell=True)
        if install.returncode != 0:
            return False
    proc = subprocess.run(["npm", "run", "build"], cwd=desktop, shell=True)
    return proc.returncode == 0


PHASES = {
    "tests": run_tests,
    "ipc": lambda: run_ipc_smoke() and run_settings_get_smoke(),
    "lint": run_lint,
    "build": run_build,
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-tests", action="store_true", help="skip pytest")
    parser.add_argument("--no-ipc", action="store_true", help="skip IPC smoke")
    parser.add_argument("--no-lint", action="store_true", help="skip ruff + eslint")
    parser.add_argument("--no-build", action="store_true", help="skip npm build")
    parser.add_argument(
        "--only",
        choices=list(PHASES),
        help="run a single phase (overrides --no-*)",
    )
    args = parser.parse_args()

    if args.only:
        phases = [args.only]
    else:
        phases = [
            name
            for name, flag in (
                ("tests", args.no_tests),
                ("ipc", args.no_ipc),
                ("lint", args.no_lint),
                ("build", args.no_build),
            )
            if not flag
        ]

    results: list[tuple[str, bool]] = []
    for name in phases:
        ok = PHASES[name]()
        results.append((name, ok))
        if not ok:
            break

    _section("summary")
    for name, ok in results:
        print(f"  {name:<6} {'OK' if ok else 'FAIL'}")
    return 0 if all(ok for _, ok in results) and len(results) == len(phases) else 1


if __name__ == "__main__":
    raise SystemExit(main())
