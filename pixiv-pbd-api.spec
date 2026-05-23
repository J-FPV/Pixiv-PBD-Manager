# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the ``pixiv-pbd-api`` Tauri sidecar.

Bundles the Python backend (``pixiv_pbd_manager.gui_api`` + all its
transitive deps: Pillow, imagehash) into a single Windows executable.
The Tauri desktop frontend will spawn this exe instead of
``python -m pixiv_pbd_manager.gui_api`` once distribution is set up.

Build:

    pyinstaller pixiv-pbd-api.spec

Output: ``dist/pixiv-pbd-api.exe`` (Windows) — accepts the same JSON
positional arg / ``--payload-file`` / ``-`` (stdin) forms as the
``python -m`` invocation.

Notes:
- ``--onefile`` mode: single .exe, extracts to %TEMP% on launch
  (adds ~200-500ms cold-start latency per invocation). Acceptable for
  the per-command IPC pattern; revisit ``--onedir`` if startup becomes
  a bottleneck.
- ``console=True`` is required: the Tauri frontend reads JSON Lines
  from the child's stdout. A windowed (console=False) build would
  attach to a hidden console with no usable pipe.
"""

from PyInstaller.utils.hooks import collect_submodules


a = Analysis(
    ['scripts/pyinstaller_entry.py'],
    pathex=[],
    binaries=[],
    datas=[],
    # Pillow auto-discovers its image plugins (JpegImagePlugin, etc.) via
    # __init__ side effects; PyInstaller's PIL hook usually catches them.
    # Add explicit submodule collection as a safety net.
    hiddenimports=collect_submodules('PIL'),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Slim the bundle: we don't use these even though Pillow may pull them
        # in via optional dependencies.
        'tkinter',
        'PyQt5',
        'PyQt6',
        'PySide2',
        'PySide6',
    ],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='pixiv-pbd-api',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
