from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from pixiv_pbd_manager.database import ArtistDatabase
from pixiv_pbd_manager.operations import rebuild_artist_work_index


class WorkIndexRebuildTests(unittest.TestCase):
    def test_preview_does_not_write_and_apply_replaces_local_ids(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "artist"
            folder.mkdir()
            (folder / "illust_100000001_20240102_030405.jpg").write_bytes(b"")
            (folder / "100000002_p1.png").write_bytes(b"")
            db_path = root / "artists.json"
            db = ArtistDatabase.load(db_path)
            db.upsert("111", name="Artist", source="manual", save_path=folder)
            db.artists["111"].work_ids = ["100000001", "20240102", "030405", "999999999"]
            db.artists["111"].new_work_ids = ["100000002", "100000003"]
            db.save()

            preview = rebuild_artist_work_index(db_path)
            unchanged = ArtistDatabase.load(db_path)
            applied = rebuild_artist_work_index(db_path, apply=True)
            rebuilt = ArtistDatabase.load(db_path)
            backup_exists = bool(applied.backup_path and applied.backup_path.exists())

        self.assertEqual(unchanged.artists["111"].work_ids, ["030405", "100000001", "20240102", "999999999"])
        self.assertEqual(preview.artists_changed, 1)
        self.assertEqual(preview.added_ids, 1)
        self.assertEqual(preview.removed_ids, 3)
        self.assertEqual(preview.pending_ids_cleared, 1)
        self.assertTrue(applied.applied)
        self.assertEqual(rebuilt.artists["111"].work_ids, ["100000001", "100000002"])
        self.assertEqual(rebuilt.artists["111"].new_work_ids, ["100000003"])
        self.assertEqual(rebuilt.artists["111"].name, "Artist")
        self.assertEqual(rebuilt.artists["111"].save_paths, [str(folder.resolve())])
        self.assertTrue(backup_exists)

    def test_artist_with_no_existing_path_is_preserved(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            db_path = root / "artists.json"
            db = ArtistDatabase.load(db_path)
            db.upsert("111", name="Missing", source="manual", save_path=root / "missing")
            db.artists["111"].work_ids = ["100000001"]
            db.save()

            result = rebuild_artist_work_index(db_path, apply=True)
            rebuilt = ArtistDatabase.load(db_path)

        self.assertEqual(result.artists_scanned, 0)
        self.assertEqual(result.artists_skipped, 1)
        self.assertEqual(len(result.missing_paths), 1)
        self.assertEqual(rebuilt.artists["111"].work_ids, ["100000001"])

    def test_conflicting_pid_is_not_assigned_to_either_artist(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = root / "first"
            second = root / "second"
            first.mkdir()
            second.mkdir()
            (first / "100000001_p0.jpg").write_bytes(b"")
            (second / "100000001_p1.jpg").write_bytes(b"")
            db_path = root / "artists.json"
            db = ArtistDatabase.load(db_path)
            db.upsert("111", name="First", source="manual", save_path=first)
            db.upsert("222", name="Second", source="manual", save_path=second)
            db.artists["111"].work_ids = ["100000001"]
            db.artists["222"].work_ids = ["100000001"]
            db.save()

            result = rebuild_artist_work_index(db_path, apply=True)
            rebuilt = ArtistDatabase.load(db_path)

        self.assertEqual(result.conflicting_ids, ["100000001"])
        self.assertEqual(rebuilt.artists["111"].work_ids, [])
        self.assertEqual(rebuilt.artists["222"].work_ids, [])

    def test_excluded_subfolder_is_not_indexed(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "artist"
            excluded = folder / "exclude"
            excluded.mkdir(parents=True)
            (folder / "100000001_p0.jpg").write_bytes(b"")
            (excluded / "100000002_p0.jpg").write_bytes(b"")
            db_path = root / "artists.json"
            db = ArtistDatabase.load(db_path)
            db.upsert("111", name="Artist", source="manual", save_path=folder)
            db.artists["111"].work_ids = ["999999999"]
            db.save()

            rebuild_artist_work_index(db_path, apply=True, exclude_roots=[excluded])
            rebuilt = ArtistDatabase.load(db_path)

        self.assertEqual(rebuilt.artists["111"].work_ids, ["100000001"])

    def test_artist_root_inside_exclude_is_skipped_not_cleared(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "excluded_artist"
            folder.mkdir()
            (folder / "100000001_p0.jpg").write_bytes(b"")
            db_path = root / "artists.json"
            db = ArtistDatabase.load(db_path)
            db.upsert("111", name="Artist", source="manual", save_path=folder)
            db.artists["111"].work_ids = ["999999999"]
            db.save()

            result = rebuild_artist_work_index(db_path, apply=True, exclude_roots=[folder])
            rebuilt = ArtistDatabase.load(db_path)

        self.assertEqual(result.artists_scanned, 0)
        self.assertEqual(rebuilt.artists["111"].work_ids, ["999999999"])

    def test_cancelled_preview_does_not_change_database(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "artist"
            folder.mkdir()
            (folder / "100000001_p0.jpg").write_bytes(b"")
            db_path = root / "artists.json"
            db = ArtistDatabase.load(db_path)
            db.upsert("111", name="Artist", source="manual", save_path=folder)
            db.artists["111"].work_ids = ["999999999"]
            db.save()

            result = rebuild_artist_work_index(db_path, apply=True, is_cancelled=lambda: True)
            rebuilt = ArtistDatabase.load(db_path)

        self.assertTrue(result.cancelled)
        self.assertEqual(rebuilt.artists["111"].work_ids, ["999999999"])


if __name__ == "__main__":
    unittest.main()
