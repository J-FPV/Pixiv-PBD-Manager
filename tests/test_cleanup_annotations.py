import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from PIL import Image

from pixiv_pbd_manager.cleanup import cleanup_summary, delete_quarantined_files, quarantine_files, restore_files
from pixiv_pbd_manager.library.annotation_identity import reconcile
from pixiv_pbd_manager.library.annotation_store import AnnotationStore
from pixiv_pbd_manager.library.annotations import cleanup_annotation_move, update_annotations
from pixiv_pbd_manager.library.catalog import build_catalog, save_library_index


class CleanupAnnotationTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.library = self.root / "library"
        self.library.mkdir()
        self.file = self.library / "image.png"
        Image.new("RGB", (10, 20), "red").save(self.file)
        self.store = AnnotationStore(self.root / "library_index.json")
        self.addCleanup(self.store.__exit__, None, None, None)
        images, _ = build_catalog([self.library])
        self.images = reconcile(self.store, images, [self.library])
        save_library_index(self.images, self.store.index_path, annotation_store_id=self.store.store_id)
        update_annotations(self.store, self.images, {"rating": 5, "tags": ["saved"]})
        self.identity = self.images[0].image_id
        self.state = self.root / "cleanup.json"
        self.callback = lambda item, state: cleanup_annotation_move(self.store, item, state)

    def quarantine(self):
        return quarantine_files([self.images[0].to_json()], quarantine_root=self.root / "quarantine",
                                protected_roots=[self.library], state_path=self.state,
                                index_path=self.root / "similar.json", annotation_callback=self.callback)

    def test_round_trip_keeps_independent_annotation_and_manifest_identity(self):
        result = self.quarantine()
        operation = result["operations"][0]
        item = operation["items"][0]
        self.assertEqual(item["library_image_id"], self.identity)
        self.assertEqual(item["annotation_store_id"], self.store.store_id)
        self.assertEqual(self.store.get(self.identity)["status"], "quarantined")
        restore_files(operation["id"], state_path=self.state, index_path=self.root / "similar.json",
                      annotation_callback=self.callback)
        self.assertEqual(self.store.get(self.identity)["status"], "linked")
        self.assertEqual(self.store.at_path(str(self.file))["body"]["rating"], 5)
        self.assertTrue(self.file.exists())

    def test_failed_move_relinks_original(self):
        with patch("pixiv_pbd_manager.cleanup.shutil.move", side_effect=OSError("disk full")):
            result = self.quarantine()
        self.assertEqual(result["moved_paths"], [])
        self.assertEqual(self.store.get(self.identity)["status"], "linked")
        self.assertEqual(self.store.at_path(str(self.file))["body"]["tags"], ["saved"])

    def test_interrupted_move_recovered_from_manifest(self):
        import shutil
        move = shutil.move
        def interrupted(source, target):
            move(source, target)
            raise KeyboardInterrupt()
        with patch("pixiv_pbd_manager.cleanup.shutil.move", side_effect=interrupted):
            with self.assertRaises(KeyboardInterrupt):
                self.quarantine()
        self.assertEqual(self.store.get(self.identity)["status"], "moving")
        cleanup_summary(self.state, annotation_callback=self.callback)
        self.assertEqual(self.store.get(self.identity)["status"], "quarantined")

    def test_delete_preserves_record_but_never_offers_it_as_move_donor(self):
        result = self.quarantine()
        operation = result["operations"][0]
        content = Path(operation["items"][0]["quarantine_path"]).read_bytes()
        delete_quarantined_files(operation["id"], state_path=self.state, annotation_callback=self.callback)
        self.assertEqual(self.store.get(self.identity)["status"], "deleted")
        self.file.write_bytes(content)
        images, _ = build_catalog([self.library])
        after = reconcile(self.store, images, [self.library])[0]
        self.assertEqual(after.rating, 0)
        self.assertNotEqual(after.image_id, self.identity)

    def test_restore_conflict_and_changed_quarantined_content(self):
        result = self.quarantine()
        operation = result["operations"][0]
        self.file.write_bytes(b"existing")
        restore_files(operation["id"], state_path=self.state, index_path=self.root / "similar.json",
                      annotation_callback=self.callback)
        self.assertEqual(self.file.read_bytes(), b"existing")
        self.assertEqual(self.store.get(self.identity)["status"], "quarantined")
        self.file.unlink()
        Path(operation["items"][0]["quarantine_path"]).write_bytes(b"replacement")
        restore_files(operation["id"], state_path=self.state, index_path=self.root / "similar.json",
                      annotation_callback=self.callback)
        self.assertFalse(self.file.exists())
        self.assertEqual(self.store.get(self.identity)["status"], "unverified")

    def test_other_store_identity_never_attaches_metadata(self):
        result = self.quarantine()
        state = json.loads(self.state.read_text())
        state["operations"][0]["items"][0]["annotation_store_id"] = "another-store"
        self.state.write_text(json.dumps(state), encoding="utf-8")
        restore_files(result["operation_id"], state_path=self.state, index_path=self.root / "similar.json",
                      annotation_callback=self.callback)
        self.assertEqual(self.store.get(self.identity)["status"], "quarantined")
