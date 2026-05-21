import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from pixiv_pbd_manager import cookie_store


class CookieStoreTests(unittest.TestCase):
    def test_roundtrip_save_and_load(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            cookie_store.save_cookie("PHPSESSID=abc_def", directory=directory)
            self.assertEqual(cookie_store.load_cookie(directory=directory), "PHPSESSID=abc_def")

    def test_empty_value_clears_existing_cookie(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            cookie_store.save_cookie("PHPSESSID=abc", directory=directory)
            cookie_store.save_cookie("", directory=directory)
            self.assertIsNone(cookie_store.load_cookie(directory=directory))

    def test_clear_cookie_removes_all_known_files(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / cookie_store.COOKIE_TXT.name).write_text("legacy", encoding="utf-8")
            (directory / cookie_store.COOKIE_BIN.name).write_bytes(b"binary")
            cookie_store.clear_cookie(directory=directory)
            self.assertFalse((directory / cookie_store.COOKIE_TXT.name).exists())
            self.assertFalse((directory / cookie_store.COOKIE_BIN.name).exists())

    def test_storage_label_reflects_files(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            self.assertEqual(cookie_store.storage_label(directory=directory), "empty")
            cookie_store.save_cookie("PHPSESSID=x", directory=directory)
            expected = "dpapi" if sys.platform == "win32" else "plaintext"
            self.assertEqual(cookie_store.storage_label(directory=directory), expected)

    def test_load_prefers_dpapi_over_plaintext_on_windows(self):
        if sys.platform != "win32":
            self.skipTest("DPAPI is Windows-only")
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            cookie_store.save_cookie("PHPSESSID=secure", directory=directory)
            self.assertTrue((directory / cookie_store.COOKIE_BIN.name).exists())
            # A stray plaintext file should be ignored when an encrypted blob exists
            (directory / cookie_store.COOKIE_TXT.name).write_text("PHPSESSID=stale", encoding="utf-8")
            self.assertEqual(cookie_store.load_cookie(directory=directory), "PHPSESSID=secure")


if __name__ == "__main__":
    unittest.main()
