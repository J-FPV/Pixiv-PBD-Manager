import ssl
import unittest
import urllib.error
from unittest.mock import patch

from pixiv_pbd_manager.resolver import PixivResolveError, fetch_artwork_author, parse_user_name_from_profile_all, parse_user_search_html


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return b'{"error": false, "body": {"userId": "126324", "userName": "96YOTTEA"}}'


class ResolverTests(unittest.TestCase):
    def test_retries_with_ssl_fallback_on_certificate_error(self):
        cert_error = urllib.error.URLError(ssl.SSLCertVerificationError("CERTIFICATE_VERIFY_FAILED"))
        with patch("urllib.request.urlopen", side_effect=[cert_error, FakeResponse()]) as urlopen:
            resolved = fetch_artwork_author("100187254")

        self.assertIsNotNone(resolved)
        assert resolved is not None
        self.assertEqual(resolved.id, "126324")
        self.assertTrue(resolved.ssl_fallback_used)
        self.assertIsNotNone(urlopen.call_args_list[1].kwargs["context"])

    def test_can_disable_ssl_fallback(self):
        cert_error = urllib.error.URLError(ssl.SSLCertVerificationError("CERTIFICATE_VERIFY_FAILED"))
        with patch("urllib.request.urlopen", side_effect=cert_error):
            with self.assertRaises(PixivResolveError):
                fetch_artwork_author("100187254", allow_insecure_ssl_fallback=False)

    def test_parse_user_search_html_candidates(self):
        raw_html = '<script type="application/json">{"props":{"userId":"123456","userName":"一条レイ"}}</script>'

        candidates = parse_user_search_html(raw_html, "一条レイ", False)

        self.assertEqual(candidates[0].id, "123456")
        self.assertEqual(candidates[0].name, "一条レイ")
        self.assertGreater(candidates[0].score, 0.9)

    def test_parse_user_name_from_profile_all_meta_title(self):
        raw = {"body": {"illusts": {}}, "extraData": {"meta": {"title": "Artist Name - pixiv"}}}

        self.assertEqual(parse_user_name_from_profile_all(raw, "123456"), "Artist Name")


if __name__ == "__main__":
    unittest.main()
