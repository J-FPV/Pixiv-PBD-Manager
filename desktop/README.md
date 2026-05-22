# Pixiv PBD Manager Desktop

This is the primary Tauri + React desktop GUI. The old Tkinter GUI is frozen on a separate branch; main keeps the Python backend and CLI, but no longer maintains Tkinter entry points.

This is still a development preview. It launches the Python backend with:

```powershell
python -m pixiv_pbd_manager.gui_api
```

The current app therefore requires a local Python environment and an editable install of the repository. A later packaging step should replace this with a PyInstaller sidecar so end users do not need to install Python manually.

## Development

Requirements:

- Node.js and npm
- Rust and Cargo
- Python environment with `pip install -e .` run from the repository root

Commands:

```powershell
cd desktop
npm install
npm run tauri:dev
```

The app calls the Python backend through JSON Lines:

```powershell
python -m pixiv_pbd_manager.gui_api settings.get "{}"
```

If the app cannot import `pixiv_pbd_manager`, open the Settings tab and set `Project root` to the repository root, then save.

If you change Rust/Tauri files, plugins, or capabilities, restart `npm run tauri:dev`. Frontend and Python changes usually hot reload.

The shell permission is intentionally narrow: the frontend can only spawn `python` or `py` with `-m pixiv_pbd_manager.gui_api`, a known GUI API command, and one JSON payload.
