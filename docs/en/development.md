# Development Notes

[中文](../zh/development.md)

This document is for people who want to modify, test, package, or release the project. Regular users should start with the root [README](../../README.en.md).

## Current GUI Direction

The main GUI uses Tauri + React + TypeScript:

```text
desktop/
```

The old Tkinter GUI is frozen on a separate branch. The `main` branch no longer maintains Tkinter entry points.

Python remains the single source of business logic. Scanning, update checks, downloading, similar-image detection, database access, settings, and cookie handling all live in the Python package. The frontend handles UI, task state, and backend calls.

## Runtime Architecture

Development mode:

- The frontend starts the source backend with `Command.create("python" | "py", ["-m", "pixiv_pbd_manager.gui_api", ...])`.
- `PYTHONPATH` points at the project root, so Python edits usually do not require rebuilding an exe.
- Restart `npm run tauri:dev` after changing `desktop/src-tauri/`, Rust code, Tauri plugins, or capability files.

Production mode:

- `python scripts/build_sidecar.py` uses PyInstaller `--onedir` to produce a backend folder, not a single-file sidecar.
- The generated folder is copied to `desktop/src-tauri/binaries/pixiv-pbd-api/`.
- `desktop/src-tauri/tauri.release.conf.json` bundles that folder via `bundle.resources`.
- After installation, the folder lives under the install directory as `pixiv-pbd-api/`, with entry point `pixiv-pbd-api/pixiv-pbd-api.exe`.
- The frontend calls it with `Command.create("pixiv-pbd-api", [commandName, payload])`; `desktop/src-tauri/capabilities/default.json` maps that command name to the install-relative executable path.

Some historical names in the repository still say `sidecar`, but the current production package is **PyInstaller onedir + Tauri resources + shell allow-list**. It does not use Tauri's `externalBin` sidecar mechanism because `externalBin` is better suited to a single executable, while this project must ship PyInstaller's `_internal/` Python runtime folder.

Frontend/backend IPC uses JSON Lines. To avoid Windows console encoding issues, the frontend sends ASCII JSON and the backend writes UTF-8 bytes to stdout.

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
  src-tauri/             # Tauri / Rust shell, capabilities, packaging config

docs/
  zh/                    # Chinese docs
  en/                    # English docs
```

## Checks

One-shot driver for backend tests, IPC smoke, ruff, eslint, and frontend build:

```powershell
python scripts/smoke.py
```

This is also what CI runs in `.github/workflows/checks.yml`. Common subsets:

```powershell
python scripts/smoke.py --only ipc      # IPC smoke only
python scripts/smoke.py --only tests    # backend tests only
python scripts/smoke.py --no-build      # skip frontend build for backend-only changes
```

Individual commands:

```powershell
python -m unittest             # backend tests
python -m pytest               # equivalent; pyproject sets -p no:cacheprovider
python -m ruff check .         # ruff lint
cd desktop; npm run lint       # frontend lint
cd desktop; npm run build      # frontend type check + production build
cd desktop\src-tauri; cargo check
```

If you change GUI API commands, Tauri shell permissions, or frontend `runGuiApi(...)` calls, run at least:

```powershell
python -m unittest tests.test_shell_permissions
```

That test keeps these three surfaces in sync:

- `pixiv_pbd_manager.gui_api.COMMANDS`
- `desktop/src-tauri/capabilities/default.json`
- frontend `runGuiApi("...")` calls

## Debugging A Single IPC Command

The Tauri frontend invokes the backend as:

```text
python -m pixiv_pbd_manager.gui_api <cmd> <json-string>
```

When invoking manually from PowerShell, argv quoting may strip the inner double quotes and produce invalid JSON (`Expecting property name enclosed in double quotes`). Use one of these forms:

```powershell
# 1. in-process: best for tests and one-offs, no shell involved
python -c "from pixiv_pbd_manager import gui_api; gui_api.run_command('settings.get', {}, emit=print)"

# 2. --payload-file: avoids shell JSON quoting
'{"settings": {}}' | Set-Content -NoNewline payload.json -Encoding utf8
python -m pixiv_pbd_manager.gui_api settings.save --payload-file payload.json

# 3. stdin: - reads the payload from stdin
'{"settings": {}}' | python -m pixiv_pbd_manager.gui_api settings.save -
```

When writing IPC smokes, note that `gui_api.payload.resolve_base_dir` walks upward looking for a directory marked by `pixiv_pbd_manager/` or `.pixiv-pbd-manager/`. Passing `project_root=/tmp/foo` alone does not isolate the test; create `<tmp>/.pixiv-pbd-manager` first, otherwise it may climb to the repo root and read or write real user state. `scripts/smoke.py` and `tests/test_gui_api.py` already handle this isolation.

Run the GUI regression checklist in [manual-test-checklist.md](../zh/manual-test-checklist.md), especially:

- window size and position restore
- scan preview
- unmatched folders
- similar-image thumbnails, preview, and difference image
- pause, resume, and cancel task flows
- Chinese / English switching
- browser opening and browser user-data-directory safety checks

## Local Packaging

Build the Python backend first:

```powershell
pip install -e ".[build]"
python scripts/build_sidecar.py
```

This:

1. Runs `pyinstaller pixiv-pbd-api.spec`.
2. Produces `dist/pixiv-pbd-api/`.
3. Copies it to `desktop/src-tauri/binaries/pixiv-pbd-api/`.

Standalone backend sanity check:

```powershell
.\dist\pixiv-pbd-api\pixiv-pbd-api.exe settings.get '{}'
```

Then build the Tauri installers:

```powershell
cd desktop
npm run tauri:build
```

Successful builds produce NSIS and MSI installers under:

```text
desktop/src-tauri/target/release/bundle/
```

If local WiX or NSIS packaging hangs, it does not necessarily mean Rust or frontend compilation failed. The CI Windows runner is the final source of truth for release installers.

## Cutting A Release

`.github/workflows/release.yml` triggers on:

- pushing a `v*` tag
- manually running workflow_dispatch from the GitHub Actions UI for dry runs

Before releasing, keep versions in sync:

- `pyproject.toml`
- `desktop/package.json`
- `desktop/package-lock.json`
- `desktop/src-tauri/Cargo.toml`
- `desktop/src-tauri/Cargo.lock`
- `desktop/src-tauri/tauri.conf.json`

Release flow:

```powershell
git status
git tag -a v0.2.0 -m "v0.2.0"
git push origin main
git push origin v0.2.0
```

GitHub Actions automatically:

1. Sets up Python / Node / Rust on a Windows runner.
2. Runs `python scripts/build_sidecar.py` to package the PyInstaller onedir backend.
3. Runs `npm run tauri:build` to produce `setup.exe` and `msi`.
4. Uses `softprops/action-gh-release@v2` to create the GitHub Release and upload installers.

Manual release checks:

```powershell
gh run list --repo J-FPV/Pixiv-PBD-Manager --workflow Release --limit 5
gh release view v0.2.0 --repo J-FPV/Pixiv-PBD-Manager
```

Tags containing `alpha`, `beta`, `rc`, or `dev` are automatically marked as prereleases.

## Data Directory

The `.pixiv-pbd-manager/` state folder is located in priority order (see `pixiv_pbd_manager/paths.py`):

1. `PIXIV_PBD_DATA_DIR` env var. It points at the parent directory; the `.pixiv-pbd-manager/` subfolder is created inside it.
2. The first existing `.pixiv-pbd-manager/` found by walking up from the current working directory.
3. OS-standard user data directory:
   - Windows: `%APPDATA%/PixivPbdManager/.pixiv-pbd-manager/`
   - macOS: `~/Library/Application Support/PixivPbdManager/.pixiv-pbd-manager/`
   - Linux: `$XDG_DATA_HOME/PixivPbdManager/.pixiv-pbd-manager/` or `~/.local/share/...`

Development runs from the repo root usually find the in-repo `.pixiv-pbd-manager/`.

Installed app runs from the Start Menu usually use `%APPDATA%\PixivPbdManager\.pixiv-pbd-manager\`.

Tauri WebView `localStorage` is managed separately by the OS. On Windows it usually lives under:

```text
%LOCALAPPDATA%\com.jfpv.pixivpbdmanager\EBWebView\
```

This stores frontend-local state such as the development `Project root` and Python command choice. The core database remains in `.pixiv-pbd-manager/`.

## Maintenance Notes

- IPC event keys are guarded by `pixiv_pbd_manager/events.py`, `desktop/src/events.ts`, and `tests/test_events.py`.
- GUI API commands must stay aligned across `pixiv_pbd_manager/gui_api/__init__.py`, Tauri shell capabilities, and frontend calls; `tests/test_shell_permissions.py` checks this.
- `.pixiv-pbd-manager` paths are centralized in `pixiv_pbd_manager/paths.py`.
- Keep business logic in Python `operations/` and `similar/`; avoid duplicating it in the frontend.
