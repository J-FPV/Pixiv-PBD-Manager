# Pixiv PBD Manager Desktop

This directory contains the primary Tauri 2 + React + TypeScript desktop interface. The old Tkinter GUI is frozen on a separate branch; `main` uses this frontend with the Python package as its business-logic backend.

For end-user installation and feature documentation, start with the root [English README](../README.en.md) or [中文 README](../README.md). This file only covers desktop development.

## Development

Requirements:

- Python 3.9+
- Node.js 20.19+ or 22.12+, plus npm
- Rust stable with the MSVC toolchain on Windows

From the repository root:

```powershell
pip install -e ".[dev]"
cd desktop
npm install
npm run tauri:dev
```

Development mode starts `python -m pixiv_pbd_manager.gui_api` through the Tauri shell plugin. Frontend and Python changes usually hot reload. Restart Tauri after changing Rust, plugins, capabilities, or files under `src-tauri/`.

To exercise the React UI without Pixiv, a Python subprocess, or a real library:

```powershell
npm run dev:mock
```

The mock server listens on `http://127.0.0.1:1421/` and provides fixed Artists, Library, Scan Preview, Similar Images, Settings, and cleanup data.

## Verification

```powershell
npm run lint
npm run build
npm run test:e2e
cd src-tauri
cargo check
```

From the repository root, `python scripts/smoke.py` runs backend tests, IPC smoke checks, Ruff, ESLint, and the frontend production build. The repository skill at `.claude/skills/run-pixiv-pbd-manager/` documents the full verification workflow and the screenshot driver in `e2e/screenshot.mjs`.

## Production Packaging

Production installers bundle a PyInstaller onedir backend under `pixiv-pbd-api/`; end users do not need Python, Node.js, or Rust.

```powershell
# Repository root
pip install -e ".[build]"
python scripts/build_sidecar.py

cd desktop
npm run tauri:build
```

The installers are written under `src-tauri/target/release/bundle/`. GitHub Actions provides two separate workflows:

- `Package`: manually creates temporary NSIS/MSI artifacts without publishing a release.
- `Release`: runs when a `v*` tag is pushed and publishes both installers to GitHub Releases.

See [Development Notes](../docs/en/development.md) for architecture, IPC, packaging, data-directory, and release details.

## IPC And Permissions

Frontend/backend messages use JSON Lines. The frontend emits ASCII JSON, while the backend writes UTF-8 bytes and accepts UTF-8 BOM input from Windows PowerShell. The shell allow-list is intentionally limited to the supported GUI API commands and install-relative helper executables.

When adding a GUI API command, keep these surfaces in sync:

- `pixiv_pbd_manager.gui_api.COMMANDS`
- `src-tauri/capabilities/default.json`
- frontend `runGuiApi(...)` calls

`python -m unittest tests.test_shell_permissions` checks this contract.
