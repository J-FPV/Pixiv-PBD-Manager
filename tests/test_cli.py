import argparse
import io
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from pixiv_pbd_manager import cli, consent


class CookieConsentGateTests(unittest.TestCase):
    def _temp_consent(self):
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        return Path(tmp.name) / "consent.json"

    def test_no_cookie_means_consent_check_passes(self):
        args = argparse.Namespace(pixiv_cookie=None, accept_cookie_risk=False)
        with patch.object(cli, "is_cookie_consent_recorded", return_value=False):
            self.assertTrue(cli.ensure_cookie_consent(args))

    def test_cookie_without_consent_is_refused(self):
        args = argparse.Namespace(pixiv_cookie="PHPSESSID=x", accept_cookie_risk=False)
        with patch.object(cli, "is_cookie_consent_recorded", return_value=False):
            buf = io.StringIO()
            with redirect_stderr(buf):
                self.assertFalse(cli.ensure_cookie_consent(args))
            self.assertIn("--accept-cookie-risk", buf.getvalue())

    def test_accept_flag_records_consent_and_passes(self):
        path = self._temp_consent()
        with patch.object(consent, "CONSENT_PATH", path), \
             patch.object(cli, "is_cookie_consent_recorded", side_effect=lambda: consent.is_cookie_consent_recorded(path)), \
             patch.object(cli, "record_cookie_consent", side_effect=lambda: consent.record_cookie_consent(path)):
            args = argparse.Namespace(pixiv_cookie="PHPSESSID=x", accept_cookie_risk=True)
            self.assertTrue(cli.ensure_cookie_consent(args))
            self.assertTrue(consent.is_cookie_consent_recorded(path))

    def test_previously_recorded_consent_passes_without_flag(self):
        args = argparse.Namespace(pixiv_cookie="PHPSESSID=x", accept_cookie_risk=False)
        with patch.object(cli, "is_cookie_consent_recorded", return_value=True):
            self.assertTrue(cli.ensure_cookie_consent(args))


if __name__ == "__main__":
    unittest.main()
