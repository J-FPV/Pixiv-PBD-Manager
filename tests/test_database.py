from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from pixiv_pbd_manager.database import ArtistDatabase


class DatabaseTests(unittest.TestCase):
    def test_rename_artist_id_preserves_record_data(self):
        with TemporaryDirectory() as tmp:
            db = ArtistDatabase.load(Path(tmp) / "artists.json")
            save_path = Path(tmp) / "artist"
            db.upsert("111", name="Artist", source="test", save_path=save_path, work_ids={"100", "101"})
            db.artists["111"].new_work_ids = ["102"]

            changed = db.rename_artist_id("111", "222")

            self.assertTrue(changed)
            self.assertNotIn("111", db.artists)
            self.assertIn("222", db.artists)
            self.assertEqual(db.artists["222"].name, "Artist")
            self.assertEqual(set(db.artists["222"].work_ids), {"100", "101"})
            self.assertEqual(db.artists["222"].new_work_ids, ["102"])
            self.assertIn(str(save_path.resolve()), db.artists["222"].save_paths)

    def test_rename_artist_id_merges_into_existing_record(self):
        with TemporaryDirectory() as tmp:
            db = ArtistDatabase.load(Path(tmp) / "artists.json")
            db.upsert("111", name="Old", work_ids={"100"})
            db.upsert("222", name="New", work_ids={"200"})

            db.rename_artist_id("111", "222")

            self.assertNotIn("111", db.artists)
            self.assertIn("222", db.artists)
            self.assertEqual(db.artists["222"].name, "New")
            self.assertEqual(set(db.artists["222"].work_ids), {"100", "200"})

    def test_set_artist_save_path_replaces_existing_paths(self):
        with TemporaryDirectory() as tmp:
            db = ArtistDatabase.load(Path(tmp) / "artists.json")
            first = Path(tmp) / "first"
            second = Path(tmp) / "second"
            db.upsert("111", name="Artist", save_path=first)

            changed = db.set_artist_save_path("111", second)

            self.assertTrue(changed)
            self.assertEqual(db.artists["111"].save_paths, [str(second.resolve())])


if __name__ == "__main__":
    unittest.main()
