import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from PIL import Image

from pixiv_pbd_manager import gui_api
from pixiv_pbd_manager.library.annotation_store import annotation_path


class AnnotationApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        (self.root / ".pixiv-pbd-manager").mkdir()
        self.index = self.root / "custom_index.json"
        self.images = self.root / "images"
        self.images.mkdir()
        self.original = self.images / "original.png"
        Image.new("RGB", (10, 20), "red").save(self.original)

    def call(self, command, **values):
        events = []
        before = Path.cwd()
        try:
            result = gui_api.run_command(command, {
                "project_root": str(self.root), "library_index": str(self.index),
                "download_roots": [str(self.images)], **values,
            }, emit=events.append)
        finally:
            os.chdir(before)
        self.assertEqual(result, 0, events)
        return events[-1]["payload"]

    def test_commands_custom_store_export_and_index_rebuild(self):
        self.call("library.scan")
        saved = self.call("library.update_metadata", paths=[str(self.original)], favorite=True, rating=5,
                          add_tags=["local"])["images"][0]
        protected = self.call("library.annotations.protect")
        self.assertEqual(protected["protected"], 1)
        self.assertTrue(annotation_path(self.index).exists())
        self.original.rename(self.images / "renamed.png")
        self.index.unlink()
        self.call("library.scan")
        current = self.call("library.list")["images"][0]
        self.assertEqual(current["image_id"], saved["image_id"])
        self.assertEqual(current["tags"], ["local"])
        self.assertEqual(current["rating"], 5)
        self.call("library.export", paths=[current["path"]], output=str(self.root / "export.csv"))
        self.assertIn("local", (self.root / "export.csv").read_text(encoding="utf-8-sig"))
        self.call("settings.save", settings={})
        self.assertEqual(self.call("library.list")["images"][0]["rating"], 5)

    def test_recovery_command_reports_and_confirms_unverified_link(self):
        self.call("library.scan")
        saved = self.call("library.set_tags", path=str(self.original), tags=["saved"])["image"]
        self.original.rename(self.images / "moved.png")
        self.call("library.scan")
        pending = self.call("library.annotations.unlinked", query="saved", page=1)
        self.assertEqual(pending["total"], 1)
        target = self.call("library.list")["images"][0]
        values = {"image_id": saved["image_id"], "annotation_revision": saved["annotation_revision"],
                  "target_id": target["image_id"]}
        preview = self.call("library.annotations.relink", **values)
        self.assertTrue(preview["confirmation_required"])
        self.call("library.annotations.relink", **values, confirm_unverified=True, confirmed_sha256=preview["target_sha256"])
        self.assertEqual(self.call("library.annotations.unlinked")["total"], 0)
        self.assertEqual(self.call("library.list")["images"][0]["tags"], ["saved"])

    def test_cleanup_preserves_identity_and_hides_quarantined_file(self):
        self.call("library.scan")
        saved = self.call("library.update_metadata", paths=[str(self.original)], rating=5)["images"][0]
        cleaned = self.call("cleanup.quarantine", items=[saved], quarantine_dir=str(self.root / "quarantine"))
        self.assertEqual(self.call("library.list")["images"], [])
        self.call("cleanup.restore", operation_id=cleaned["operation_id"])
        self.call("library.scan")
        restored = self.call("library.list")["images"][0]
        self.assertEqual((restored["image_id"], restored["rating"]), (saved["image_id"], 5))
        raw = json.loads(self.index.read_text())
        self.assertNotIn("rating", next(iter(raw["entries"].values())))
