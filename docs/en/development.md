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

Backend tests:

```powershell
python -m unittest
```

Ruff:

```powershell
python -m ruff check .
```

Pytest:

```powershell
python -m pytest
```

Frontend type check and production build:

```powershell
cd desktop
npm run lint
npm run build
```

Rust check:

```powershell
cd desktop\src-tauri
cargo check
```

Run the GUI regression checklist in [manual-test-checklist.md](../zh/manual-test-checklist.md), especially after frontend or IPC changes.

## Packaging Direction

The current development build depends on the user's Python environment. The intended packaging path is to build the Python backend with PyInstaller as a Tauri sidecar, then ship a Tauri installer so end users do not need to install Python dependencies manually.

## Maintenance Notes

- IPC event keys are guarded by `pixiv_pbd_manager/events.py` and `desktop/src/events.ts`.
- `.pixiv-pbd-manager` paths are centralized in `pixiv_pbd_manager/paths.py`.
- New Tauri shell backend commands must also be added to `desktop/src-tauri/capabilities/default.json`.
- Keep business logic in Python `operations/` and `similar/`; avoid duplicating it in the frontend.
