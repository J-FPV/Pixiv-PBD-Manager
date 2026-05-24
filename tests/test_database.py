from pathlib import Path
from tempfile import TemporaryDirectory
import json
import unittest

from pixiv_pbd_manager.database import ArtistDatabase


class DatabaseLoadResilienceTests(unittest.TestCase):
    def test_load_empty_file_returns_empty_db(self):
        # An interrupted save (or the prior os-error-206 crash) can leave a
        # zero-byte artists.json. ``load`` must not raise — every downstream
        # IPC command depends on it.
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "artists.json"
            path.write_text("", encoding="utf-8")
            db = ArtistDatabase.load(path)
            self.assertEqual(db.artists, {})

    def test_load_corrupt_json_returns_empty_db(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "artists.json"
            path.write_text("{not json", encoding="utf-8")
            db = ArtistDatabase.load(path)
            self.assertEqual(db.artists, {})

    def test_load_non_dict_top_level_returns_empty_db(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "artists.json"
            path.write_text("[1, 2, 3]", encoding="utf-8")
            db = ArtistDatabase.load(path)
            self.assertEqual(db.artists, {})

    def test_load_repairs_utf8_text_decoded_as_gbk_with_surrogates(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "artists.json"
            mojibake_name = "カンザリン".encode("utf-8").decode("gbk", errors="surrogateescape")
            mojibake_path = str(Path(tmp) / "illus-カンザリン").encode("utf-8").decode(
                "gbk",
                errors="surrogateescape",
            )
            path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "artists": {
                            "31133701": {
                                "id": "31133701",
                                "name": mojibake_name,
                                "save_paths": [mojibake_path],
                                "sources": [],
                                "download_roots": [],
                                "work_ids": [],
                                "new_work_ids": [],
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )

            db = ArtistDatabase.load(path)

        self.assertEqual(db.artists["31133701"].name, "カンザリン")
        self.assertTrue(db.artists["31133701"].save_paths[0].endswith("illus-カンザリン"))

    def test_load_repairs_surrogate_free_mojibake_when_repaired_path_exists(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "artists.json"
            real_folder = Path(tmp) / "illus-針金紳士"
            real_folder.mkdir()
            mojibake_name = "針金紳士".encode("utf-8").decode("gbk")
            mojibake_path = str(real_folder).encode("utf-8").decode("gbk")

            path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "artists": {
                            "123456": {
                                "id": "123456",
                                "name": mojibake_name,
                                "save_paths": [mojibake_path],
                                "sources": [],
                                "download_roots": [],
                                "work_ids": [],
                                "new_work_ids": [],
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )

            db = ArtistDatabase.load(path)

        self.assertEqual(db.artists["123456"].name, "針金紳士")
        self.assertEqual(db.artists["123456"].save_paths, [str(real_folder)])


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

    def test_remove_many_deletes_existing_artists(self):
        with TemporaryDirectory() as tmp:
            db = ArtistDatabase.load(Path(tmp) / "artists.json")
            db.upsert("111", name="First")
            db.upsert("222", name="Second")

            removed = db.remove_many(["111", "333"])

            self.assertEqual(removed, ["111"])
            self.assertNotIn("111", db.artists)
            self.assertIn("222", db.artists)


if __name__ == "__main__":
    unittest.main()
