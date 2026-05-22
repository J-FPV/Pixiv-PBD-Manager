import unittest

from pixiv_pbd_manager.i18n import text


class I18nTests(unittest.TestCase):
    def test_returns_english_backend_text(self):
        self.assertIn("--accept-cookie-risk", text("en", "consent_required_cli"))

    def test_falls_back_to_english_for_unknown_language(self):
        self.assertEqual(text("missing", "consent_required_cli"), text("en", "consent_required_cli"))

    def test_unknown_key_returns_key(self):
        self.assertEqual(text("en", "missing_key"), "missing_key")


if __name__ == "__main__":
    unittest.main()
