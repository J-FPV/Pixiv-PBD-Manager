"""Tests for the data-directory resolution logic in ``paths.py`` and the
APPDATA fallback in ``gui_api.payload.resolve_base_dir``."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from pixiv_pbd_manager import paths
from pixiv_pbd_manager.gui_api.payload import resolve_base_dir


class ClearEnv:
    """Context manager that clears a set of env vars and restores them after."""

    def __init__(self, *names: str) -> None:
        self.names = names
        self.saved: dict[str, str | None] = {}

    def __enter__(self) -> None:
        for name in self.names:
            self.saved[name] = os.environ.pop(name, None)

    def __exit__(self, *exc) -> None:
        for name, value in self.saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


class ResolveDataDirTests(unittest.TestCase):
    def test_env_var_takes_precedence(self):
        with TemporaryDirectory() as tmp:
            os.environ[paths.DATA_DIR_ENV_VAR] = tmp
            try:
                resolved = paths.resolve_data_dir()
                self.assertEqual(resolved, Path(tmp) / paths.LEGACY_DATA_DIR_NAME)
            finally:
                os.environ.pop(paths.DATA_DIR_ENV_VAR, None)

    def test_legacy_walk_up_wins_over_appdata_when_marker_exists(self):
        with TemporaryDirectory() as tmp, ClearEnv(paths.DATA_DIR_ENV_VAR):
            legacy = Path(tmp) / paths.LEGACY_DATA_DIR_NAME
            legacy.mkdir()
            resolved = paths.resolve_data_dir(start=Path(tmp))
            # ``_find_legacy_data_dir`` resolves the path (expanding e.g.
            # ``RUNNER~1`` to ``runneradmin`` on Windows), so resolve both
            # sides before comparing.
            self.assertEqual(resolved, legacy.resolve())

    def test_falls_back_to_appdata_when_no_marker_and_no_env(self):
        with TemporaryDirectory() as tmp, ClearEnv(paths.DATA_DIR_ENV_VAR):
            # Force _appdata_root to a known location by patching os.environ APPDATA.
            with patch.object(paths, "_appdata_root", return_value=Path(tmp) / "fake-appdata" / paths.APP_FOLDER_NAME):
                resolved = paths.resolve_data_dir(start=Path(tmp))
            self.assertEqual(resolved.name, paths.LEGACY_DATA_DIR_NAME)
            self.assertIn("fake-appdata", str(resolved))
            self.assertIn(paths.APP_FOLDER_NAME, str(resolved))

    def test_appdata_root_uses_platform_specific_location(self):
        if sys.platform == "win32":
            with patch.dict(os.environ, {"APPDATA": r"C:\fake\Roaming"}, clear=False):
                self.assertEqual(paths._appdata_root(), Path(r"C:\fake\Roaming") / "PixivPbdManager")
        elif sys.platform == "darwin":
            self.assertEqual(
                paths._appdata_root(),
                Path.home() / "Library" / "Application Support" / "PixivPbdManager",
            )
        else:
            with patch.dict(os.environ, {"XDG_DATA_HOME": "/fake/xdg"}, clear=False):
                self.assertEqual(paths._appdata_root(), Path("/fake/xdg") / "PixivPbdManager")


class ResolveBaseDirTests(unittest.TestCase):
    """The gui_api ``resolve_base_dir`` wraps the data-dir resolution with the
    project-root convention. These tests cover its fallback to APPDATA."""

    def test_falls_back_to_appdata_when_no_marker_and_no_project_root(self):
        with TemporaryDirectory() as tmp, ClearEnv(paths.DATA_DIR_ENV_VAR):
            old_cwd = Path.cwd()
            os.chdir(tmp)
            try:
                # No marker in tmp; resolve_base_dir should choose APPDATA. Patch
                # _appdata_root to a fake under tmp so we don't touch real state.
                fake_appdata = Path(tmp) / "appdata"
                with patch("pixiv_pbd_manager.gui_api.payload._appdata_root", return_value=fake_appdata):
                    base = resolve_base_dir(None)
                self.assertEqual(base, fake_appdata)
                # Side effect: appdata + .pixiv-pbd-manager subfolder are created.
                self.assertTrue(fake_appdata.is_dir())
                self.assertTrue((fake_appdata / ".pixiv-pbd-manager").is_dir())
            finally:
                os.chdir(old_cwd)

    def test_env_override_beats_appdata(self):
        with TemporaryDirectory() as tmp:
            override = Path(tmp) / "user-chosen"
            os.environ[paths.DATA_DIR_ENV_VAR] = str(override)
            try:
                old_cwd = Path.cwd()
                # Move to a directory that has no marker so the fallback path runs.
                empty = Path(tmp) / "empty"
                empty.mkdir()
                os.chdir(empty)
                try:
                    with patch(
                        "pixiv_pbd_manager.gui_api.payload._appdata_root",
                        side_effect=AssertionError("should not call APPDATA when env set"),
                    ):
                        base = resolve_base_dir(None)
                    self.assertEqual(base, override)
                    self.assertTrue((override / ".pixiv-pbd-manager").is_dir())
                finally:
                    os.chdir(old_cwd)
            finally:
                os.environ.pop(paths.DATA_DIR_ENV_VAR, None)

    def test_resolver_skips_meipass_when_source_root_is_disabled(self):
        # In a PyInstaller bundle, ``__file__`` lives under sys._MEIPASS — a
        # temp dir that PyInstaller deletes on process exit. The temp dir
        # CONTAINS pixiv_pbd_manager/ (PyInstaller's extraction), so the
        # walk-up heuristic ``_looks_like_project_root`` matches it. If we
        # picked it as base_dir, writes would vanish seconds later. The fix
        # sets SOURCE_ROOT=None when sys.frozen is set; this test simulates
        # that and verifies we fall through to APPDATA instead.
        from pixiv_pbd_manager.gui_api import payload as payload_module

        with TemporaryDirectory() as tmp, ClearEnv(paths.DATA_DIR_ENV_VAR):
            # Empty cwd with no marker anywhere on the walk-up path.
            empty_cwd = Path(tmp) / "empty"
            empty_cwd.mkdir()
            old_cwd = Path.cwd()
            os.chdir(empty_cwd)
            try:
                fake_appdata = Path(tmp) / "appdata"
                with patch.object(payload_module, "SOURCE_ROOT", None), patch.object(
                    payload_module, "_appdata_root", return_value=fake_appdata
                ):
                    # project_root is a non-existent relative path so all
                    # candidates fail _nearest_project_root, forcing the
                    # fallback path that SOURCE_ROOT used to short-circuit.
                    base = resolve_base_dir("does-not-resolve")
                self.assertEqual(base, fake_appdata)
            finally:
                os.chdir(old_cwd)

    def test_legacy_marker_still_wins_when_present(self):
        with TemporaryDirectory() as tmp, ClearEnv(paths.DATA_DIR_ENV_VAR):
            (Path(tmp) / ".pixiv-pbd-manager").mkdir()
            old_cwd = Path.cwd()
            os.chdir(tmp)
            try:
                # APPDATA must NOT be consulted when a marker exists.
                with patch(
                    "pixiv_pbd_manager.gui_api.payload._appdata_root",
                    side_effect=AssertionError("should not call APPDATA when marker exists"),
                ):
                    base = resolve_base_dir(None)
                self.assertEqual(base.resolve(), Path(tmp).resolve())
            finally:
                os.chdir(old_cwd)


if __name__ == "__main__":
    unittest.main()
