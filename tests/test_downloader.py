import unittest

from pixiv_pbd_manager.downloader import extension_from_url, safe_filename


class DownloaderTests(unittest.TestCase):
    def test_safe_filename_replaces_windows_invalid_chars(self):
        self.assertEqual(safe_filename('a:b*c?d.jpg'), "a_b_c_d.jpg")

    def test_extension_from_url(self):
        self.assertEqual(extension_from_url("https://i.pximg.net/img-original/foo.png"), ".png")


if __name__ == "__main__":
    unittest.main()
