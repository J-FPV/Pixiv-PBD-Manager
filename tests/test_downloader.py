import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pixiv_pbd_manager.downloader import (
    RESTRICTED_SUBDIR,
    PixivPage,
    download_artwork,
    download_binary,
    extension_from_url,
    fetch_artwork_pages,
    safe_filename,
)
from pixiv_pbd_manager.operations import collect_local_work_ids
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

    def test_download_binary_reports_progress_and_writes_file(self):
        class FakeImageResponse:
            headers = {"Content-Length": "6"}

            def __init__(self):
                self.chunks = [b"abc", b"def", b""]

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _size):
                return self.chunks.pop(0)

        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "image.jpg"
            events = []
            with patch("urllib.request.urlopen", return_value=FakeImageResponse()):
                ssl_used = download_binary(
                    "https://i.pximg.net/x.jpg",
                    output,
                    referer="https://www.pixiv.net/artworks/1",
                    progress_callback=lambda downloaded, total, speed: events.append((downloaded, total, speed)),
                )

            self.assertFalse(ssl_used)
            self.assertEqual(output.read_bytes(), b"abcdef")
            self.assertEqual(events[-1][0], 6)
            self.assertEqual(events[-1][1], 6)
            self.assertGreater(events[-1][2], 0)

    def test_download_artwork_routes_restricted_into_subfolder(self):
        page = PixivPage(index=0, original_url="https://i.pximg.net/x_p0.jpg")
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            with patch("pixiv_pbd_manager.downloader.fetch_artwork_xrestrict", return_value=(1, False)), patch(
                "pixiv_pbd_manager.downloader.fetch_artwork_pages", return_value=([page], False)
            ), patch("pixiv_pbd_manager.downloader.download_binary", return_value=False):
                result = download_artwork("123", target, separate_restricted=True, delay_seconds=0)
            self.assertIsNone(result.error)
            self.assertEqual(Path(result.saved_files[0]).parent.name, RESTRICTED_SUBDIR)

    def test_download_artwork_keeps_allages_in_base_folder(self):
        page = PixivPage(index=0, original_url="https://i.pximg.net/x_p0.jpg")
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            with patch("pixiv_pbd_manager.downloader.fetch_artwork_xrestrict", return_value=(0, False)), patch(
                "pixiv_pbd_manager.downloader.fetch_artwork_pages", return_value=([page], False)
            ), patch("pixiv_pbd_manager.downloader.download_binary", return_value=False):
                result = download_artwork("123", target, separate_restricted=True, delay_seconds=0)
            self.assertEqual(Path(result.saved_files[0]).parent, target)


class LocalWorkIdScanTests(unittest.TestCase):
    def test_collect_local_work_ids_includes_subfolders(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            (base / "sub").mkdir()
            (base / "111111_p0.jpg").write_bytes(b"x")
            (base / "sub" / "222222_p0.jpg").write_bytes(b"x")
            ids = collect_local_work_ids([str(base)])
        self.assertEqual(ids, {"111111", "222222"})


if __name__ == "__main__":
    unittest.main()
