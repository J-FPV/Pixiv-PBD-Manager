from __future__ import annotations

import json
import shutil
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from PIL import Image

from pixiv_pbd_manager.library.annotation_identity import ProtectionCancelled, protect, reconcile
from pixiv_pbd_manager.library.annotation_store import AnnotationStore, annotation_path
from pixiv_pbd_manager.library.annotations import annotated_catalog, recovery_list, relink, update_annotations
from pixiv_pbd_manager.library.catalog import build_catalog, save_library_index


class AnnotationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.images = self.root / "images"
        self.images.mkdir()
        self.index = self.root / "library_index.json"
        self.original = self.images / "original.png"
        Image.new("RGB", (20, 30), "red").save(self.original)

    def scan(self, store):
        images, _ = build_catalog([self.images])
        images = reconcile(store, images, [self.images])
        save_library_index(images, self.index, annotation_store_id=store.store_id)
        return images

    def annotate(self, store):
        image = self.scan(store)[0]
        update_annotations(store, [image], {"favorite": True, "rating": 4, "tags": ["reference"], "markers": ["used"]})
        protect(store, [self.images])
        return image

    def test_legacy_migration_backup_and_rebuild(self):
        images, _ = build_catalog([self.images])
        images[0].tags = ["old"]
        images[0].rating = 5
        save_library_index(images, self.index)
        original = self.index.read_bytes()
        with annotated_catalog(self.index) as (store, catalog):
            self.assertEqual(catalog[str(self.original)].tags, ["old"])
            identity = catalog[str(self.original)].image_id
            protect(store, [self.images])
            self.scan(store)
        self.assertEqual(self.index.with_suffix(".json.pre-annotations.bak").read_bytes(), original)
        raw = json.loads(self.index.read_text())
        self.assertEqual(raw["version"], 3)
        self.assertNotIn("tags", next(iter(raw["entries"].values())))
        self.index.unlink()
        with AnnotationStore(self.index) as store:
            rebuilt = self.scan(store)[0]
            self.assertEqual((rebuilt.image_id, rebuilt.tags, rebuilt.rating), (identity, ["old"], 5))

    def test_legacy_file_moved_before_first_upgrade_is_offered_for_recovery(self):
        images, _ = build_catalog([self.images])
        images[0].tags = ["legacy"]
        save_library_index(images, self.index)
        self.original.rename(self.images / "moved-before-upgrade.png")
        with AnnotationStore(self.index) as store:
            after = self.scan(store)
            pending = recovery_list(store, {image.path: image for image in after})
            self.assertEqual(pending["total"], 1)
            self.assertEqual(pending["entries"][0]["tags"], ["legacy"])
            self.assertEqual(after[0].tags, [])

    def test_rename_keeps_annotations_but_copy_does_not_share(self):
        with AnnotationStore(self.index) as store:
            before = self.annotate(store)
            copied = self.images / "copy.png"
            shutil.copy2(self.original, copied)
            after = {Path(image.path).name: image for image in self.scan(store)}
            self.assertFalse(after["copy.png"].favorite)
            self.assertNotEqual(after["copy.png"].image_id, before.image_id)
            renamed = self.images / "renamed.png"
            self.original.rename(renamed)
            after = {Path(image.path).name: image for image in self.scan(store)}
            self.assertEqual(after["renamed.png"].image_id, before.image_id)
            self.assertEqual(after["renamed.png"].rating, 4)
            self.assertFalse(after["copy.png"].favorite)

    def test_cross_volume_style_copy_then_remove(self):
        with AnnotationStore(self.index) as store:
            before = self.annotate(store)
            shutil.copyfile(self.original, self.images / "moved.png")
            self.original.unlink()
            after = self.scan(store)[0]
            self.assertEqual(after.image_id, before.image_id)
            self.assertTrue(after.favorite)

    def test_whole_directory_copy_then_remove_keeps_annotations(self):
        with AnnotationStore(self.index) as store:
            before = self.annotate(store)
            destination = self.root / "new-root"
            destination.mkdir()
            shutil.copyfile(self.original, destination / "moved.png")
            self.original.unlink()
            self.images.rmdir()
            self.images = destination
            self.assertEqual(self.scan(store)[0].image_id, before.image_id)

    def test_offline_device_is_not_an_automatic_hash_donor(self):
        with AnnotationStore(self.index) as store:
            before = self.annotate(store)
            shutil.copyfile(self.original, self.images / "new.png")
            self.original.unlink()
            row = store.get(before.image_id)
            row["signature"][2] = "offline-device"
            store.connection.execute("UPDATE images SET signature=? WHERE id=?",
                                     (json.dumps(row["signature"]), before.image_id))
            self.assertEqual(self.scan(store)[0].rating, 0)
            self.assertEqual(store.get(before.image_id)["body"]["rating"], 4)

    def test_replaced_original_does_not_inherit_but_moved_original_does(self):
        with AnnotationStore(self.index) as store:
            before = self.annotate(store)
            self.original.rename(self.images / "z-moved.png")
            Image.new("RGB", (20, 30), "blue").save(self.original)
            after = {Path(image.path).name: image for image in self.scan(store)}
            self.assertFalse(after["original.png"].favorite)
            self.assertEqual(after["z-moved.png"].image_id, before.image_id)

    def test_duplicate_candidates_require_manual_recovery(self):
        with AnnotationStore(self.index) as store:
            before = self.annotate(store)
            for name in ("a.png", "b.png"):
                shutil.copyfile(self.original, self.images / name)
            self.original.unlink()
            images = self.scan(store)
            self.assertTrue(all(not image.favorite for image in images))
            pending = recovery_list(store, {image.path: image for image in images})
            self.assertEqual(pending["total"], 1)
            result = relink(store, before.image_id, images[0], before.annotation_revision)
            self.assertFalse(result["confirmation_required"])
            self.assertTrue(images[0].favorite)
            self.assertFalse(images[1].favorite)

    def test_unverified_move_requires_confirmation(self):
        with AnnotationStore(self.index) as store:
            before = self.scan(store)[0]
            update_annotations(store, [before], {"rating": 3})
            self.original.rename(self.images / "renamed.png")
            after = self.scan(store)[0]
            result = relink(store, before.image_id, after, before.annotation_revision)
            self.assertTrue(result["confirmation_required"])
            self.assertEqual(result["reason"], "unverified")
            relink(store, before.image_id, after, before.annotation_revision, confirm_unverified=True,
                   confirmed_sha256=result["target_sha256"])
            self.assertEqual(after.rating, 3)

    def test_explicitly_cleared_target_cannot_be_overwritten(self):
        with AnnotationStore(self.index) as store:
            before = self.annotate(store)
            Image.new("RGB", (30, 40), "blue").save(self.images / "target.png")
            self.original.unlink()
            target = self.scan(store)[0]
            update_annotations(store, [target], {"favorite": False})
            with self.assertRaisesRegex(ValueError, "already has"):
                relink(store, before.image_id, target, before.annotation_revision, confirm_unverified=True)

    def test_cancellation_never_publishes_partial_reconciliation(self):
        with AnnotationStore(self.index) as store:
            before = self.annotate(store)
            self.original.rename(self.images / "moved.png")
            images, _ = build_catalog([self.images])
            with self.assertRaises(ProtectionCancelled):
                reconcile(store, images, [self.images], lambda: True)
            self.assertEqual(store.get(before.image_id)["path"], str(self.original))

    def test_protection_cancel_resume_and_unchanged_annotations(self):
        with AnnotationStore(self.index) as store:
            before = self.scan(store)[0]
            update_annotations(store, [before], {"rating": 5})
            result = protect(store, [self.images], should_cancel=lambda: True)
            self.assertTrue(result["cancelled"])
            self.assertEqual(result["pending"], 1)
            self.assertEqual(protect(store, [self.images])["protected"], 1)

    def test_missing_or_corrupt_store_never_silently_recreated(self):
        with AnnotationStore(self.index) as store:
            self.annotate(store)
        annotation_path(self.index).unlink()
        with self.assertRaisesRegex(RuntimeError, "missing"):
            AnnotationStore(self.index)
        annotation_path(self.index).write_bytes(b"broken database")
        with self.assertRaises(sqlite3.DatabaseError):
            AnnotationStore(self.index)

    def test_concurrent_edits_merge_without_lost_fields(self):
        with AnnotationStore(self.index) as store:
            self.scan(store)
        def edit(patch):
            with annotated_catalog(self.index) as (store, catalog):
                update_annotations(store, list(catalog.values()), patch)
        with ThreadPoolExecutor(max_workers=2) as executor:
            list(executor.map(edit, [{"favorite": True}, {"rating": 5}]))
        with annotated_catalog(self.index) as (_store, catalog):
            image = next(iter(catalog.values()))
            self.assertTrue(image.favorite)
            self.assertEqual((image.rating, image.annotation_revision), (5, 2))

    def test_empty_database_after_interrupted_first_migration_retries(self):
        sqlite3.connect(annotation_path(self.index)).close()
        with AnnotationStore(self.index) as store:
            self.assertTrue(store.store_id)

    def test_unicode_and_same_named_files_remain_independent(self):
        with AnnotationStore(self.index) as store:
            before = self.annotate(store)
            folder = self.images / "参考图-日本語"
            folder.mkdir()
            other = folder / self.original.name
            shutil.copyfile(self.original, other)
            self.original.rename(self.images / "星空-イラスト.png")
            images = self.scan(store)
            moved = next(image for image in images if image.image_id == before.image_id)
            copied = next(image for image in images if image.path == str(other))
            self.assertEqual(moved.tags, ["reference"])
            self.assertEqual(copied.annotation_revision, 0)

    def test_two_lost_annotated_copies_do_not_arbitrarily_claim_two_new_copies(self):
        second = self.images / "second.png"
        shutil.copyfile(self.original, second)
        with AnnotationStore(self.index) as store:
            images = self.scan(store)
            update_annotations(store, images, {"rating": 4})
            protect(store, [self.images])
            for name in ("new-a.png", "new-b.png"):
                shutil.copyfile(self.original, self.images / name)
            self.original.unlink()
            second.unlink()
            after = self.scan(store)
            self.assertTrue(all(image.rating == 0 for image in after))
            self.assertEqual(store.status()["unlinked"], 2)

    def test_initial_protection_failure_retries_without_losing_annotations(self):
        with AnnotationStore(self.index) as store:
            image = self.scan(store)[0]
            update_annotations(store, [image], {"rating": 4})
            with patch("pixiv_pbd_manager.library.annotation_identity.verified_hash", side_effect=PermissionError("offline")):
                self.assertEqual(protect(store, [self.images])["errors"], 1)
            self.assertEqual(protect(store, [self.images])["protected"], 0)
            result = protect(store, [self.images], retry=True)
            self.assertEqual((result["protected"], result["errors"]), (1, 0))
            self.assertEqual(store.get(image.image_id)["body"]["rating"], 4)

    def test_changed_file_before_first_hash_is_not_claimed_as_original(self):
        with AnnotationStore(self.index) as store:
            image = self.scan(store)[0]
            update_annotations(store, [image], {"rating": 4})
            Image.new("RGB", (25, 30), "blue").save(self.original)
            self.assertEqual(protect(store, [self.images])["unlinked"], 1)
            after = self.scan(store)[0]
            self.assertEqual(after.rating, 0)
            self.assertNotEqual(image.image_id, after.image_id)
            preview = relink(store, image.image_id, after, image.annotation_revision)
            self.assertEqual(preview["reason"], "unverified")

    def test_failed_batch_write_rolls_back_every_annotation(self):
        Image.new("RGB", (15, 20), "blue").save(self.images / "second.png")
        with AnnotationStore(self.index) as store:
            images = self.scan(store)
            store.connection.execute(f"""CREATE TRIGGER simulate_disk_error BEFORE UPDATE OF body ON images
                WHEN NEW.id='{images[1].image_id}' BEGIN SELECT RAISE(ABORT, 'disk full'); END""")
            with self.assertRaises(sqlite3.IntegrityError):
                update_annotations(store, images, {"rating": 5})
            store.overlay(images)
            self.assertTrue(all(image.rating == 0 for image in images))

    def test_changed_target_between_preview_and_confirmation_is_rejected(self):
        with AnnotationStore(self.index) as store:
            image = self.scan(store)[0]
            update_annotations(store, [image], {"rating": 4})
            self.original.rename(self.images / "moved.png")
            target = self.scan(store)[0]
            preview = relink(store, image.image_id, target, image.annotation_revision)
            Image.new("RGB", (25, 30), "blue").save(target.path)
            with self.assertRaisesRegex(ValueError, "Target file changed"):
                relink(store, image.image_id, target, image.annotation_revision, confirm_unverified=True,
                       confirmed_sha256=preview["target_sha256"])
