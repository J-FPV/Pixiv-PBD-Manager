from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from pixiv_pbd_manager.gui_api.commands.app_info import latest_release


class _Response:
    def __init__(self, payload: dict[str, object]):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


class AppInfoTests(unittest.TestCase):
    def test_latest_release_detects_newer_version(self):
        response = _Response(
            {
                "tag_name": "v0.2.0",
                "name": "Version 0.2.0",
                "html_url": "https://example.invalid/release",
                "published_at": "2026-01-01T00:00:00Z",
                "body": "Changes",
            }
        )
        with patch("pixiv_pbd_manager.gui_api.commands.app_info.urlopen", return_value=response):
            result = latest_release({"current_version": "0.1.8"}, lambda _event: None)

        self.assertTrue(result["update_available"])
        self.assertEqual(result["tag"], "v0.2.0")
        self.assertEqual(result["notes"], "Changes")


if __name__ == "__main__":
    unittest.main()
