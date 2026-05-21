import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from pixiv_pbd_manager import consent


class ConsentTests(unittest.TestCase):
    def test_initially_not_recorded(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "consent.json"
            self.assertFalse(consent.is_cookie_consent_recorded(path=path))

    def test_record_then_detect(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "consent.json"
            consent.record_cookie_consent(path=path)
            self.assertTrue(consent.is_cookie_consent_recorded(path=path))

    def test_revoke_clears_recorded_state(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "consent.json"
            consent.record_cookie_consent(path=path)
            consent.revoke_cookie_consent(path=path)
            self.assertFalse(consent.is_cookie_consent_recorded(path=path))

    def test_mismatched_version_treated_as_not_recorded(self):
        path_dir = TemporaryDirectory()
        self.addCleanup(path_dir.cleanup)
        path = Path(path_dir.name) / "consent.json"
        path.write_text(
            '{"cookie": {"accepted_at": "2020-01-01T00:00:00+00:00", "version": "999"}}',
            encoding="utf-8",
        )
        self.assertFalse(consent.is_cookie_consent_recorded(path=path))

    def test_corrupt_file_treated_as_not_recorded(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "consent.json"
            path.write_text("not json", encoding="utf-8")
            self.assertFalse(consent.is_cookie_consent_recorded(path=path))


if __name__ == "__main__":
    unittest.main()
