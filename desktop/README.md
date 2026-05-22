# Pixiv PBD Manager Desktop

This is the parallel Tauri + React desktop GUI. It keeps the existing Python Tkinter GUI and CLI intact.

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

The first version calls the Python backend through JSON Lines:

```powershell
python -m pixiv_pbd_manager.gui_api settings.get "{}"
```

If the app cannot import `pixiv_pbd_manager`, open the Settings tab and set `Project root` to the repository root, then save.
