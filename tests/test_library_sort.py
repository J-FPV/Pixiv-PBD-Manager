from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

from pixiv_pbd_manager.gui_api.serializers import library_image_to_json
from pixiv_pbd_manager.library import (
    build_catalog,
    library_index_status,
    load_library_index,
    save_library_index,
    save_library_index_metadata,
)
from pixiv_pbd_manager.library.catalog import LIBRARY_INDEX_VERSION, library_index_metadata_path
from pixiv_pbd_manager.library.timestamps import file_creation_time_ns


class CreationTimeTests(unittest.TestCase):
    def test_prefers_nanosecond_birthtime(self):
        stat = SimpleNamespace(st_birthtime_ns=123456789, st_birthtime=123, st_ctime_ns=999)
        self.assertEqual(file_creation_time_ns(stat), 123456789)

    def test_supports_second_resolution_birthtime(self):
        self.assertEqual(file_creation_time_ns(SimpleNamespace(st_birthtime=1.25)), 1_250_000_000)

    def test_old_windows_uses_ctime(self):
        with patch("sys.platform", "win32"), patch("sys.version_info", (3, 11)):
            self.assertEqual(file_creation_time_ns(SimpleNamespace(st_ctime_ns=42)), 42)

    def test_unix_ctime_is_not_creation_time(self):
        with patch("sys.platform", "linux"):
            self.assertIsNone(file_creation_time_ns(SimpleNamespace(st_ctime_ns=42)))

    def test_modern_windows_without_birthtime_returns_unknown(self):
        with patch("sys.platform", "win32"), patch("sys.version_info", (3, 12)):
            self.assertIsNone(file_creation_time_ns(SimpleNamespace(st_ctime_ns=42)))


class CatalogUpgradeTests(unittest.TestCase):
    def test_legacy_catalog_backfills_creation_without_decoding_or_losing_metadata(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "\u753b\u50cf_\u661f\u7a7a.png"
            Image.new("RGB", (12, 20)).save(path)
            images, _ = build_catalog([root])
            original = images[0]
            original.tags = ["reference"]
            original.pixiv_tags = [{"tag": "sky", "translation": ""}]
            original.favorite = True
            original.rating = 5
            original.markers = ["high_value"]
            legacy = original.to_json()
            del legacy["created_ns"]
            index = root / "library_index.json"
            index.write_text(json.dumps({"version": 1, "entries": {original.path: legacy}}), encoding="utf-8")
            old = load_library_index(index)
            self.assertIsNone(old[original.path].created_ns)
            self.assertIsNone(library_image_to_json(old[original.path])["created_ns"])
            with (
                patch("pixiv_pbd_manager.library.catalog.read_image_size", side_effect=AssertionError("Decoded")),
                patch("pixiv_pbd_manager.library.catalog.file_creation_time_ns", return_value=123456789),
            ):
                updated, summary = build_catalog([root], old_catalog=old)
            self.assertEqual(summary.reused, 1)
            self.assertEqual(summary.changed, 0)
            self.assertEqual(updated[0].to_json(), {**legacy, "created_ns": 123456789})
            save_library_index(updated, index)
            self.assertEqual(load_library_index(index)[original.path].created_ns, 123456789)
            self.assertEqual(library_image_to_json(updated[0])["created_ns"], 123456789)

    def test_old_metadata_triggers_one_refresh_even_after_a_metadata_edit(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            index = root / "library_index.json"
            save_library_index([], index)
            save_library_index_metadata(index, [root], [], entry_count=0, timestamp=1000)
            meta_path = library_index_metadata_path(index)
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            meta["version"] = 1
            meta_path.write_text(json.dumps(meta), encoding="utf-8")
            # Tag/ratings writes may upgrade the JSON envelope, but must not
            # mark the filesystem's missing creation metadata as scanned.
            save_library_index([], index)
            status = library_index_status(index, [root], [], now=1100)
            self.assertIn("schema_changed", status["reasons"])
            save_library_index_metadata(index, [root], [], entry_count=0, timestamp=1000)
            self.assertFalse(library_index_status(index, [root], [], now=1100)["stale"])
            self.assertEqual(json.loads(meta_path.read_text(encoding="utf-8"))["version"], LIBRARY_INDEX_VERSION)

    def test_null_creation_round_trips_without_permanent_staleness(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            Image.new("RGB", (12, 20)).save(root / "unknown.png")
            with patch("pixiv_pbd_manager.library.catalog.file_creation_time_ns", return_value=None):
                images, _ = build_catalog([root])
            index = root / "library_index.json"
            save_library_index(images, index)
            save_library_index_metadata(index, [root], [], entry_count=1, timestamp=1000)
            self.assertIsNone(next(iter(load_library_index(index).values())).created_ns)
            self.assertFalse(library_index_status(index, [root], [], now=1100)["stale"])
