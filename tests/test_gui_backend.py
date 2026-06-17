import json
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
import time
import unittest
from unittest.mock import patch

from pixiv_pbd_manager import downloader
from pixiv_pbd_manager.database import ArtistDatabase
from pixiv_pbd_manager.downloader import ArtworkDownloadResult
from pixiv_pbd_manager.operations import (
    check_artist_updates,
    download_artist_updates,
    preview_scan_changes,
    scan_into_database,
)
from pixiv_pbd_manager.operations.updates import normalize_download_concurrency
from pixiv_pbd_manager.resolver import (
    PixivResolveError,
    PixivUserCandidate,
    PixivUserWorks,
    ResolvedArtist,
    fetch_artwork_tags,
)


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

    def test_scan_uses_existing_save_path_without_online_request(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "downloads"
            folder = root / "96YOTTEA's illustrations／manga - pixiv"
            image = folder / "100187254_p0.jpg"
            folder.mkdir(parents=True)
            image.write_bytes(b"")
            db_path = Path(tmp) / "artists.json"
            db = ArtistDatabase.load(db_path)
            db.upsert("126324", name="96YOTTEA", source="manual", save_path=folder)
            db.save()

            with patch("pixiv_pbd_manager.resolver.resolve_name_only_artist") as online:
                result = scan_into_database([root], db_path, resolve_online=True)

            online.assert_not_called()
            self.assertEqual(result.resolved_name_only, 0)

    def test_scan_continues_after_one_folder_resolution_error(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "downloads"
            first = root / "First's illustrations - pixiv" / "100187254_p0.jpg"
            second = root / "Second's illustrations - pixiv" / "100187255_p0.jpg"
            first.parent.mkdir(parents=True)
            second.parent.mkdir(parents=True)
            first.write_bytes(b"")
            second.write_bytes(b"")
            db_path = Path(tmp) / "artists.json"

            with patch(
                "pixiv_pbd_manager.resolver.resolve_name_only_artist",
                side_effect=[
                    PixivResolveError("temporary failure"),
                    ResolvedArtist(id="126325", name="Second", work_id="100187255"),
                ],
            ):
                result = scan_into_database([root], db_path, resolve_online=True)

            db = ArtistDatabase.load(db_path)
            self.assertIn("126325", db.artists)
            self.assertEqual(len(result.resolve_errors), 1)

    def test_scan_into_database_resolves_unmatched_folder_by_pid(self):
        # A plain-named folder (no artist id, not a Pixiv name pattern) with
        # PID-named files is resolved online from a sampled work id.
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "downloads"
            image = root / "随手存的图" / "100187254_p0.jpg"
            image.parent.mkdir(parents=True)
            image.write_bytes(b"")
            db_path = Path(tmp) / "artists.json"

            with patch(
                "pixiv_pbd_manager.resolver.resolve_name_only_artist",
                return_value=ResolvedArtist(id="126324", name="96YOTTEA", work_id="100187254"),
            ):
                result = scan_into_database([root], db_path, resolve_online=True)
            db = ArtistDatabase.load(db_path)

            self.assertEqual(result.resolved_by_pid, 1)
            self.assertIn("126324", db.artists)
            self.assertIn(str(image.parent.resolve()), db.artists["126324"].save_paths)
            self.assertNotIn(str(image.parent.resolve()), result.summary.unmatched_folders)

    def test_scan_into_database_resolves_scan_root_by_pid(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "plain-folder"
            image = root / "100187254_p0.jpg"
            root.mkdir(parents=True)
            image.write_bytes(b"")
            db_path = Path(tmp) / "artists.json"

            with patch(
                "pixiv_pbd_manager.resolver.resolve_name_only_artist",
                return_value=ResolvedArtist(id="126324", name="96YOTTEA", work_id="100187254"),
            ):
                result = scan_into_database([root], db_path, resolve_online=True)
            db = ArtistDatabase.load(db_path)

            self.assertEqual(result.resolved_by_pid, 1)
            self.assertIn("126324", db.artists)
            self.assertIn(str(root.resolve()), db.artists["126324"].save_paths)

    def test_unmatched_folder_with_pid_stays_unmatched_offline(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "downloads"
            image = root / "随手存的图" / "100187254_p0.jpg"
            image.parent.mkdir(parents=True)
            image.write_bytes(b"")
            db_path = Path(tmp) / "artists.json"

            result = scan_into_database([root], db_path, resolve_online=False)

            self.assertEqual(result.resolved_by_pid, 0)
            self.assertIn(str(image.parent.resolve()), result.summary.unmatched_folders)

    def test_scan_resolves_unknown_pid_folder_from_existing_database(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "downloads"
            image = root / "moved-folder" / "100187254_p0.jpg"
            image.parent.mkdir(parents=True)
            image.write_bytes(b"")
            db_path = Path(tmp) / "artists.json"
            db = ArtistDatabase.load(db_path)
            db.upsert("126324", name="96YOTTEA", source="manual", work_ids={"100187254"})
            db.save()

            result = scan_into_database([root], db_path, resolve_online=False)
            db = ArtistDatabase.load(db_path)

            self.assertEqual(result.resolved_by_pid, 1)
            self.assertIn(str(image.parent.resolve()), db.artists["126324"].save_paths)
            self.assertNotIn(str(image.parent.resolve()), result.summary.unmatched_folders)

    def test_scan_keeps_mixed_known_pid_folder_unmatched(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "downloads"
            folder = root / "mixed-folder"
            first = folder / "100187254_p0.jpg"
            second = folder / "100187255_p0.jpg"
            folder.mkdir(parents=True)
            first.write_bytes(b"")
            second.write_bytes(b"")
            db_path = Path(tmp) / "artists.json"
            db = ArtistDatabase.load(db_path)
            db.upsert("126324", name="A", source="manual", work_ids={"100187254"})
            db.upsert("126325", name="B", source="manual", work_ids={"100187255"})
            db.save()

            result = scan_into_database([root], db_path, resolve_online=False)

            self.assertEqual(result.resolved_by_pid, 0)
            self.assertIn(str(folder.resolve()), result.summary.unmatched_folders)

    def test_unresolved_name_only_folder_surfaces_as_unmatched(self):
        # A ``... - pixiv`` folder whose sample work ids don't resolve (offline,
        # or R-18 with no cookie) must not silently vanish: it has no artist id
        # so it can't be recognized, so it should appear in unmatched_folders for
        # the user to handle manually.
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "downloads"
            image = root / "96YOTTEA's illustrations／manga - pixiv" / "100187254_p0.jpg"
            image.parent.mkdir(parents=True)
            image.write_bytes(b"")
            db_path = Path(tmp) / "artists.json"

            result = scan_into_database([root], db_path, resolve_online=False)

            self.assertEqual(result.resolved_name_only, 0)
            self.assertIn(str(image.parent.resolve()), result.summary.unmatched_folders)

    def test_resolved_name_only_folder_not_listed_as_unmatched(self):
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

            self.assertEqual(result.resolved_name_only, 1)
            self.assertNotIn(str(image.parent.resolve()), result.summary.unmatched_folders)

    def test_scan_is_cancellable_and_does_not_write(self):
        # A cancel signal must stop the scan promptly: no online resolve, no DB
        # write, and the result flagged cancelled so the GUI doesn't pop a preview.
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "downloads"
            image = root / "96YOTTEA's illustrations／manga - pixiv" / "100187254_p0.jpg"
            image.parent.mkdir(parents=True)
            image.write_bytes(b"")
            db_path = Path(tmp) / "artists.json"

            with patch(
                "pixiv_pbd_manager.resolver.resolve_name_only_artist",
                side_effect=AssertionError("resolver must not run when cancelled"),
            ):
                result = scan_into_database(
                    [root], db_path, resolve_online=True, should_cancel=lambda: True
                )

            self.assertTrue(result.cancelled)
            self.assertEqual(result.changed, 0)
            self.assertFalse(db_path.exists(), "a cancelled scan must not write the database")

    def test_scan_preview_reports_cancelled(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "downloads"
            image = root / "随手存的图" / "100187254_p0.jpg"
            image.parent.mkdir(parents=True)
            image.write_bytes(b"")
            db_path = Path(tmp) / "artists.json"

            result = preview_scan_changes(
                [root], db_path, resolve_online=True, should_cancel=lambda: True
            )

            self.assertTrue(result.cancelled)
            self.assertEqual(result.changes, [])

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

    def test_download_artist_updates_can_run_parallel(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "downloads"
            root.mkdir()
            db_path = Path(tmp) / "artists.json"
            db = ArtistDatabase.load(db_path)
            db.upsert("123456", name="Artist", save_path=root, work_ids={"100"})
            db.artists["123456"].new_work_ids = ["101", "102", "103", "104"]
            db.save()
            lock = threading.Lock()
            active = 0
            max_active = 0

            def fake_download(work_id, save_path, **_kwargs):
                nonlocal active, max_active
                with lock:
                    active += 1
                    max_active = max(max_active, active)
                time.sleep(0.05)
                with lock:
                    active -= 1
                return ArtworkDownloadResult(work_id=str(work_id), saved_files=[str(Path(save_path) / f"{work_id}_p0.jpg")])

            with patch("pixiv_pbd_manager.downloader.download_artwork", side_effect=fake_download):
                result = download_artist_updates(db_path, download_concurrency=3)
            db = ArtistDatabase.load(db_path)

            self.assertGreaterEqual(max_active, 2)
            self.assertEqual(result.artworks, 4)
            self.assertEqual(db.artists["123456"].new_work_ids, [])

    def test_fetch_artwork_tags_parses_tag_and_translation(self):
        body = {
            "error": False,
            "body": {"tags": {"tags": [
                {"tag": "水色髪", "translation": {"en": "light blue hair"}},
                {"tag": "オリジナル"},
            ]}},
        }
        with patch("pixiv_pbd_manager.resolver.read_pixiv_json", return_value=body):
            tags, ssl_used = fetch_artwork_tags("101")
        self.assertFalse(ssl_used)
        self.assertEqual([t.tag for t in tags], ["水色髪", "オリジナル"])
        self.assertEqual(tags[0].translation, "light blue hair")
        self.assertEqual(tags[1].translation, "")

    def test_fetch_artwork_tags_raises_on_error_body(self):
        with patch("pixiv_pbd_manager.resolver.read_pixiv_json", return_value={"error": True, "message": "restricted"}):
            with self.assertRaises(PixivResolveError):
                fetch_artwork_tags("101")

    def test_download_concurrency_is_clamped(self):
        self.assertEqual(normalize_download_concurrency(0), 1)
        self.assertEqual(normalize_download_concurrency(3), 3)
        self.assertEqual(normalize_download_concurrency(99), 5)

    def test_fetch_artwork_pages_rejects_restricted_placeholder(self):
        # Pixiv serves a "limit_*" placeholder for restricted works requested
        # without a cookie; treat that as restricted, not a downloadable page.
        body = json.dumps(
            {"error": False, "body": [{"urls": {"original": "https://s.pximg.net/common/images/limit_sanity_level_360.png"}}]}
        )
        with patch("pixiv_pbd_manager.downloader.read_url_text_with_ssl_fallback", return_value=(body, False)):
            with self.assertRaises(PixivResolveError):
                downloader.fetch_artwork_pages("101")

    def test_download_artist_updates_does_not_record_failed_work(self):
        # A restricted/failed artwork (error result) must not be merged, so it
        # stays in the artist's available-updates list.
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
                return_value=ArtworkDownloadResult(work_id="101", error="Artwork 101 is restricted"),
            ):
                result = download_artist_updates(db_path)
            db = ArtistDatabase.load(db_path)

            self.assertEqual(result.artworks, 0)
            self.assertNotIn("101", db.artists["123456"].work_ids)
            self.assertEqual(db.artists["123456"].new_work_ids, ["101"])

    def test_download_artist_updates_stops_on_cancel(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "downloads"
            root.mkdir()
            db_path = Path(tmp) / "artists.json"
            db = ArtistDatabase.load(db_path)
            db.upsert("123456", name="Artist", save_path=root, work_ids={"100"})
            db.artists["123456"].new_work_ids = ["101", "102", "103"]
            db.save()
            done = {"n": 0}

            def fake_download(work_id, save_path, **_kwargs):
                done["n"] += 1
                return ArtworkDownloadResult(work_id=str(work_id), saved_files=[str(Path(save_path) / f"{work_id}_p0.jpg")])

            with patch("pixiv_pbd_manager.downloader.download_artwork", side_effect=fake_download):
                result = download_artist_updates(db_path, should_cancel=lambda: done["n"] >= 1)
            db = ArtistDatabase.load(db_path)

            self.assertTrue(result.cancelled)
            self.assertEqual(result.artworks, 1)
            self.assertEqual(len(db.artists["123456"].new_work_ids), 2)


if __name__ == "__main__":
    unittest.main()
