import unittest

from pixiv_pbd_manager.i18n import text


class I18nTests(unittest.TestCase):
    def test_returns_english_text(self):
        self.assertEqual(text("en", "scan"), "Scan folders")

    def test_falls_back_to_chinese_for_unknown_language(self):
        self.assertEqual(text("missing", "scan"), "扫描目录")

    def test_formats_variables(self):
        self.assertEqual(text("en", "artist_count", count=3), "Artists: 3")


if __name__ == "__main__":
    unittest.main()
