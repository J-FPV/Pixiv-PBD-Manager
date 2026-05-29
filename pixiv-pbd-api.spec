# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the ``pixiv-pbd-api`` Tauri sidecar.

Bundles the Python backend (``pixiv_pbd_manager.gui_api`` + all its
transitive deps: Pillow, imagehash) into a folder layout that the
Tauri desktop frontend spawns instead of ``python -m pixiv_pbd_manager.gui_api``.

Build:

    pyinstaller pixiv-pbd-api.spec

Output: ``dist/pixiv-pbd-api/`` containing ``pixiv-pbd-api.exe`` +
``_internal/`` directory with the Python runtime and dependencies.
The exe accepts the same JSON positional arg / ``--payload-file`` /
``-`` (stdin) forms as the ``python -m`` invocation.

Notes:
- ``--onedir`` mode: the exe expects ``_internal/`` next to itself.
  No per-launch extraction → ~50ms cold start (vs ~500ms for the
  earlier ``--onefile`` build). Also lets the Tauri frontend's
  kill/stdin propagate directly to the Python process (no bootloader
  child to lose track of).
- The PyInstaller worker stays ``console=True`` so stdout/stderr/stdin are
  normal pipes. On Windows, ``scripts/build_sidecar.py`` compiles a tiny
  GUI-subsystem launcher named ``pixiv-pbd-api.exe`` that starts this worker
  with ``CREATE_NO_WINDOW`` and proxies the pipes. This keeps the GUI clean
  without breaking JSON Lines IPC.
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
        # Slim the bundle: explicitly exclude packages PyInstaller's static
        # import analysis pulls in transitively but we never use at runtime.
        # Pillow's optional GUI integrations and numpy/scipy's optional interop
        # modules can each balloon the bundle by hundreds of MB.
        'tkinter',
        'PyQt5',
        'PyQt6',
        'PySide2',
        'PySide6',
        'torch',
        'pandas',
        'matplotlib',
        'sklearn',
        'jupyter',
        'IPython',
        'notebook',
        'pytest',
        'sphinx',
    ],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='pixiv-pbd-api-worker',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name='pixiv-pbd-api',
)
