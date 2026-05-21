import unittest
from unittest.mock import patch

from pixiv_pbd_manager.downloader import extension_from_url, fetch_artwork_pages, safe_filename
from pixiv_pbd_manager.resolver import PixivResolveError


class DownloaderTests(unittest.TestCase):
    def test_safe_filename_replaces_windows_invalid_chars(self):
        self.assertEqual(safe_filename('a:b*c?d.jpg'), "a_b_c_d.jpg")

    def test_extension_from_url(self):
        self.assertEqual(extension_from_url("https://i.pximg.net/img-original/foo.png"), ".png")

    def test_fetch_artwork_pages_passes_cookie_through(self):
        captured = {}

        def fake_read(url, **kwargs):
            captured["url"] = url
            captured["cookie"] = kwargs.get("cookie")
            return ('{"body": [{"urls": {"original": "https://i.pximg.net/x_p0.jpg"}}]}', False)

        with patch("pixiv_pbd_manager.downloader.read_url_text_with_ssl_fallback", side_effect=fake_read):
            pages, _ = fetch_artwork_pages("12345", pixiv_cookie="PHPSESSID=abc")

        self.assertEqual(captured["cookie"], "PHPSESSID=abc")
        self.assertEqual(len(pages), 1)
        self.assertEqual(pages[0].original_url, "https://i.pximg.net/x_p0.jpg")

    def test_fetch_artwork_pages_surfaces_pixiv_message(self):
        def fake_read(url, **kwargs):
            return ('{"error": true, "message": "作品が見つかりません"}', False)

        with patch("pixiv_pbd_manager.downloader.read_url_text_with_ssl_fallback", side_effect=fake_read):
            with self.assertRaises(PixivResolveError) as ctx:
                fetch_artwork_pages("12345")

        self.assertIn("作品が見つかりません", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
