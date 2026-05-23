# Development Notes

[中文](../zh/development.md)

This document is for people who want to modify or package the project. Regular users should start with the root [README](../../README.en.md).

## Current GUI Direction

The main GUI uses Tauri + React + TypeScript:

```text
desktop/
```

The old Tkinter GUI is frozen on a separate branch. The `main` branch no longer maintains Tkinter entry points.

The frontend launches the Python JSON Lines API through Tauri shell:

```text
python -m pixiv_pbd_manager.gui_api
```

Python remains the single source of business logic for scanning, update checks, downloading, similar-image detection, database access, and settings.

## Development Environment

Install:

- Python 3.9 or newer
- Node.js and npm
- Rust and Cargo

Initialize:

```powershell
pip install -e ".[dev]"
cd desktop
npm install
```

Run the development GUI:

```powershell
npm run tauri:dev
```

If the Tauri UI cannot import `pixiv_pbd_manager`, set `Project root` in Settings to the repository root.

Restart `npm run tauri:dev` after changing `desktop/src-tauri/`, Tauri plugins, or capability files. Pure frontend and Python backend changes usually hot reload.

## Project Structure

```text
pixiv_pbd_manager/
  cli.py                 # CLI entry point
  database.py            # artists.json database
  browser.py             # browser / PBD page opening
  downloader.py          # direct downloader
  events.py              # backend IPC event keys
  paths.py               # .pixiv-pbd-manager path constants
  gui_api/               # JSON Lines API used by Tauri
  operations/            # scan, preview, update, download orchestration
  similar/               # similar-image indexing and grouping

desktop/
  src/                   # React frontend
  src-tauri/             # Tauri / Rust shell

docs/
  zh/                    # Chinese docs
  en/                    # English docs
```

## Checks

One-shot driver — pytest + IPC roundtrip + ruff + eslint + frontend build (same script CI runs in `.github/workflows/checks.yml`):

```powershell
python scripts/smoke.py
```

Common subsets:

```powershell
python scripts/smoke.py --only ipc      # IPC smoke only
python scripts/smoke.py --only tests    # backend tests only
python scripts/smoke.py --no-build      # skip the frontend build for backend-only PRs
```

Individual commands:

```powershell
python -m unittest             # backend tests (what CI runs)
python -m pytest               # equivalent; pyproject already sets -p no:cacheprovider
python -m ruff check .         # ruff lint
cd desktop; npm run lint       # frontend lint
cd desktop; npm run build      # frontend type check + production build
cd desktop\src-tauri; cargo check
```

## Debugging a single IPC command

The Tauri frontend invokes the backend as `python -m pixiv_pbd_manager.gui_api <cmd> <json-string>`. When invoking manually from PowerShell, **argv quoting strips the inner double quotes** out of the JSON argument (you get `Expecting property name enclosed in double quotes`). Three usable forms:

```powershell
# 1. in-process — best for tests and one-offs (no shell at all)
python -c "from pixiv_pbd_manager import gui_api; gui_api.run_command('settings.get', {}, emit=print)"

# 2. --payload-file — equivalent to what Tauri's subprocess call does, no shell quoting
'{"settings": {}}' | Set-Content -NoNewline payload.json -Encoding utf8
python -m pixiv_pbd_manager.gui_api settings.save --payload-file payload.json

# 3. stdin — `-` reads the payload from stdin
'{"settings": {}}' | python -m pixiv_pbd_manager.gui_api settings.save -
```

When writing IPC smokes, note that `gui_api.payload.resolve_base_dir` **walks upward** looking for a directory marked by `pixiv_pbd_manager/` or `.pixiv-pbd-manager/`. Passing `project_root=/tmp/foo` alone does *not* isolate — the walk-up climbs out of the fixture and lands on the repo root, reading/writing the real user state. To isolate, `mkdir <tmp>/.pixiv-pbd-manager` first. The `settings.get` phase in `scripts/smoke.py` does this and asserts `settings_path` stays inside the fixture.

Run the GUI regression checklist in [manual-test-checklist.md](../zh/manual-test-checklist.md), especially after frontend or IPC changes.

## Packaging Direction

The current development build depends on the user's Python environment. The intended packaging path is to build the Python backend with PyInstaller as a Tauri sidecar, then ship a Tauri installer so end users do not need to install Python dependencies manually.

## Maintenance Notes

- IPC event keys are guarded by `pixiv_pbd_manager/events.py` and `desktop/src/events.ts`.
- `.pixiv-pbd-manager` paths are centralized in `pixiv_pbd_manager/paths.py`.
- New Tauri shell backend commands must also be added to `desktop/src-tauri/capabilities/default.json`.
- Keep business logic in Python `operations/` and `similar/`; avoid duplicating it in the frontend.
