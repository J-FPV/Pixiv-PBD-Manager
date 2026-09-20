from __future__ import annotations

import ctypes
from ctypes import wintypes
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from pixiv_pbd_manager.operations import preview_scan_changes
from pixiv_pbd_manager.scanner import scan_roots


@unittest.skipUnless(os.name == "nt", "Windows short-path aliases only")
class ScanShortPathTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name).resolve()
        self.root = self.base / "Scanner Long Path Regression"
        artist = self.root / "Artist-555666"
        artist.mkdir(parents=True)
        (artist / "12345678_p0.jpg").touch()
        self.unmatched = self.root / "misc"
        self.unmatched.mkdir()
        (self.unmatched / "23456789_p0.jpg").touch()
        get_short_path = ctypes.WinDLL("kernel32", use_last_error=True).GetShortPathNameW
        get_short_path.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD]
        get_short_path.restype = wintypes.DWORD
        size = get_short_path(str(self.root), None, 0)
        if not size:
            raise ctypes.WinError(ctypes.get_last_error())
        buffer = ctypes.create_unicode_buffer(size)
        if not get_short_path(str(self.root), buffer, size):
            raise ctypes.WinError(ctypes.get_last_error())
        self.short_root = Path(buffer.value)
        if os.path.normcase(str(self.short_root)) == os.path.normcase(str(self.root)):
            self.skipTest("This filesystem does not provide an 8.3 alias")
        self.assertEqual(self.short_root.resolve(), self.root)

    def test_short_and_long_roots_produce_the_same_preview_and_evidence(self):
        database = self.base / "artists.json"
        canonical = preview_scan_changes([self.root], database)
        aliased = preview_scan_changes([self.short_root], database)
        self.assertEqual(aliased.changes, canonical.changes)
        self.assertEqual(aliased.summary.artist_folder_hits, canonical.summary.artist_folder_hits)
        self.assertEqual(aliased.changes[0]["save_paths"], [str(self.root / "Artist-555666")])
        self.assertEqual(aliased.summary.unmatched_folders, {str(self.unmatched): 1})
        self.assertFalse(database.exists(), "preview must not write the database")

    def test_overlapping_long_and_short_roots_do_not_scan_files_twice(self):
        summary = scan_roots([self.root, self.short_root], max_depth=1)
        self.assertEqual(summary.files_seen, 2)
        self.assertEqual(summary.files_matched, 1)
        self.assertEqual(summary.artists["555666"].work_ids, {"12345678"})
        self.assertEqual(summary.unmatched_folders, {str(self.unmatched): 1})
