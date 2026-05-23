from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from pixiv_pbd_manager.database import ArtistDatabase
from pixiv_pbd_manager.downloader import ArtworkDownloadResult
from pixiv_pbd_manager.operations import check_artist_updates, download_artist_updates, scan_into_database
from pixiv_pbd_manager.resolver import PixivUserCandidate, PixivUserWorks, ResolvedArtist


class GuiBackendTests(unittest.TestCase):
    def test_scan_into_database_persists_artist(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "downloads"
            image = root / "pixiv" / "Gui Artist-555666" / "12345678-title.jpg"
            image.parent.mkdir(parents=True)
            image.write_bytes(b"")
            db_path = Path(tmp) / "artists.json"

            result = scan_into_database([root], db_path)
            db = ArtistDatabase.load(db_path)

            self.assertEqual(result.summary.files_seen, 1)
            self.assertIn("555666", db.artists)
            self.assertEqual(db.artists["555666"].name, "Gui Artist")
            self.assertIn(str(image.parent.resolve()), db.artists["555666"].save_paths)

    def test_scan_into_database_resolves_name_only_pixiv_folder(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "downloads"
            image = root / "96YOTTEA's illustrations／manga - pixiv" / "100187254_p0.jpg"
            image.parent.mkdir(parents=True)
            image.write_bytes(b"")
            db_path = Path(tmp) / "artists.json"

            with patch(
                "pixiv_pbd_manager.resolver.resolve_name_only_artist",
                return_value=ResolvedArtist(id="126324", name="96YOTTEA", work_id="100187254"),
            ):
                result = scan_into_database([root], db_path, resolve_online=True)
            db = ArtistDatabase.load(db_path)

            self.assertEqual(result.resolved_name_only, 1)
            self.assertIn("126324", db.artists)
            self.assertEqual(db.artists["126324"].name, "96YOTTEA")

    def test_scan_into_database_fuzzy_resolves_manual_illus_folder(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "downloads"
            image = root / "illus-一条レイ-赛璐璐-contrast color-dot" / "sample.jpg"
            image.parent.mkdir(parents=True)
            image.write_bytes(b"")
            db_path = Path(tmp) / "artists.json"

            with patch(
                "pixiv_pbd_manager.resolver.resolve_name_by_fuzzy_search",
                return_value=PixivUserCandidate(id="123456", name="一条レイ", score=0.91, source="test"),
            ):
                result = scan_into_database([root], db_path, resolve_online=True, fuzzy_search_names=True)
            db = ArtistDatabase.load(db_path)

            self.assertEqual(result.fuzzy_resolved_name_only, 1)
            self.assertIn("123456", db.artists)
            self.assertIn(str(image.parent.resolve()), db.artists["123456"].save_paths)

    def test_scan_into_database_respects_exclude_roots(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "downloads"
            keep = root / "keep" / "Keep Artist-101010" / "12345678-title.jpg"
            skip = root / "skip" / "Skip Artist-202020" / "87654321-title.jpg"
            keep.parent.mkdir(parents=True)
            skip.parent.mkdir(parents=True)
            keep.write_bytes(b"")
            skip.write_bytes(b"")
            db_path = Path(tmp) / "artists.json"

            result = scan_into_database([root], db_path, exclude_roots=[root / "skip"])
            db = ArtistDatabase.load(db_path)

            self.assertEqual(result.summary.files_seen, 1)
            self.assertIn("101010", db.artists)
            self.assertNotIn("202020", db.artists)

    def test_check_artist_updates_records_new_work_ids(self):
        with TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "artists.json"
            db = ArtistDatabase.load(db_path)
            db.upsert("123456", name="Artist", work_ids={"100", "101"})
            db.save()

            with patch(
                "pixiv_pbd_manager.resolver.fetch_user_work_ids",
                return_value=PixivUserWorks(user_id="123456", work_ids={"100", "101", "102", "103"}),
            ):
                result = check_artist_updates(db_path)
            db = ArtistDatabase.load(db_path)

            self.assertEqual(result.checked, 1)
            self.assertEqual(result.artists_with_updates, 1)
            self.assertEqual(result.new_works, 2)
            self.assertEqual(set(db.artists["123456"].new_work_ids), {"102", "103"})

    def test_check_artist_updates_passes_max_pages(self):
        with TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "artists.json"
            db = ArtistDatabase.load(db_path)
            db.upsert("123456", name="Artist", work_ids={"100"})
            db.save()

            with patch(
                "pixiv_pbd_manager.resolver.fetch_user_work_ids",
                return_value=PixivUserWorks(user_id="123456", work_ids={"100", "101"}),
            ) as fetch:
                check_artist_updates(db_path, max_pages=2)

            self.assertEqual(fetch.call_args.kwargs["max_pages"], 2)

    def test_check_artist_updates_rescans_artist_root_files_by_default(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "downloads"
            root.mkdir()
            (root / "100002_p0.jpg").write_bytes(b"fake")
            db_path = Path(tmp) / "artists.json"
            db = ArtistDatabase.load(db_path)
            db.upsert("123456", name="Artist", save_path=root, work_ids={"100000"})
            db.save()

            with patch(
                "pixiv_pbd_manager.resolver.fetch_user_work_ids",
                return_value=PixivUserWorks(user_id="123456", work_ids={"100000", "100002", "100003"}),
            ):
                result = check_artist_updates(db_path)
            db = ArtistDatabase.load(db_path)

            self.assertEqual(result.new_works, 1)
            self.assertIn("100002", db.artists["123456"].work_ids)
            self.assertEqual(db.artists["123456"].new_work_ids, ["100003"])

    def test_check_artist_updates_only_rescans_subfolders_when_enabled(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "downloads"
            nested = root / "nested"
            nested.mkdir(parents=True)
            (nested / "100002_p0.jpg").write_bytes(b"fake")
            db_path = Path(tmp) / "artists.json"
            db = ArtistDatabase.load(db_path)
            db.upsert("123456", name="Artist", save_path=root, work_ids={"100000"})
            db.save()

            with patch(
                "pixiv_pbd_manager.resolver.fetch_user_work_ids",
                return_value=PixivUserWorks(user_id="123456", work_ids={"100000", "100002"}),
            ):
                check_artist_updates(db_path, scan_local=False)
            db = ArtistDatabase.load(db_path)
            self.assertEqual(db.artists["123456"].new_work_ids, ["100002"])

            with patch(
                "pixiv_pbd_manager.resolver.fetch_user_work_ids",
                return_value=PixivUserWorks(user_id="123456", work_ids={"100000", "100002"}),
            ):
                check_artist_updates(db_path, scan_local=True)
            db = ArtistDatabase.load(db_path)
            self.assertIn("100002", db.artists["123456"].work_ids)
            self.assertEqual(db.artists["123456"].new_work_ids, [])

    def test_check_artist_updates_reports_progress(self):
        with TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "artists.json"
            db = ArtistDatabase.load(db_path)
            db.upsert("123456", name="Artist", work_ids={"100"})
            db.save()
            events = []

            with patch(
                "pixiv_pbd_manager.resolver.fetch_user_work_ids",
                return_value=PixivUserWorks(user_id="123456", work_ids={"100", "101"}),
            ):
                check_artist_updates(db_path, progress_callback=lambda key, payload: events.append((key, payload)))

            self.assertIn("progress_check_start", [key for key, _payload in events])
            self.assertIn("progress_check_artist", [key for key, _payload in events])

    def test_download_artist_updates_marks_completed_work_ids(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "downloads"
            root.mkdir()
            db_path = Path(tmp) / "artists.json"
            db = ArtistDatabase.load(db_path)
            db.upsert("123456", name="Artist", save_path=root, work_ids={"100"})
            db.artists["123456"].new_work_ids = ["101"]
            db.save()

            with patch(
                "pixiv_pbd_manager.downloader.download_artwork",
                return_value=ArtworkDownloadResult(work_id="101", saved_files=[str(root / "101_p0.jpg")]),
            ):
                result = download_artist_updates(db_path)
            db = ArtistDatabase.load(db_path)

            self.assertEqual(result.artworks, 1)
            self.assertIn("101", db.artists["123456"].work_ids)
            self.assertNotIn("101", db.artists["123456"].new_work_ids)


if __name__ == "__main__":
    unittest.main()
