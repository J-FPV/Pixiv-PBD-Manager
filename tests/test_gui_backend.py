from __future__ import annotations

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
from pixiv_pbd_manager.library import LibraryImage, TagCacheEntry, load_tag_cache, save_tag_cache
from pixiv_pbd_manager.operations import (
    check_artist_updates,
    download_artist_updates,
    fetch_pixiv_tags,
    preview_scan_changes,
    scan_into_database,
)
from pixiv_pbd_manager.operations.updates import normalize_download_concurrency
from pixiv_pbd_manager.resolver import (
    ArtworkTag,
    PixivResolveError,
    PixivUserCandidate,
    PixivUserWorks,
    ResolvedArtist,
    fetch_artwork_tags,
)


def _library_image(pid: str, name: str = "", pixiv_tags: list[dict[str, str]] | None = None) -> LibraryImage:
    return LibraryImage(
        path=str(Path("D:/lib") / (name or f"{pid}_p0.jpg")),
        size_bytes=10,
        mtime_ns=1,
        width=4,
        height=4,
        format="jpg",
        pid=pid,
        pixiv_tags=list(pixiv_tags or []),
    )


def _tags(name: str) -> list[dict[str, str]]:
    return [{"tag": name, "translation": ""}]


def _tag_response(name: str):
    return ([ArtworkTag(tag=name, translation="")], False)


class GuiBackendTests(unittest.TestCase):
    def test_scan_preview_includes_human_explainable_match_sources(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "downloads"
            image = root / "Preview Artist-555666" / "12345678-title.jpg"
            image.parent.mkdir(parents=True)
            image.write_bytes(b"")
            db_path = Path(tmp) / "artists.json"

            result = preview_scan_changes([root], db_path)

            self.assertEqual(len(result.changes), 1)
            change = result.changes[0]
            self.assertEqual(change["kind"], "new_artist")
            self.assertEqual(change["match_sources"], change["sources"])
            self.assertTrue(change["match_sources"][0].startswith("folder:"))

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


class TagFetchOperationTests(unittest.TestCase):
    """The incremental fetch loop in ``operations.tags``.

    All of these patch ``pixiv_pbd_manager.resolver.fetch_artwork_tags`` and run
    with ``delay_seconds=0`` so no test sleeps on the rate limiter.
    """

    def _run(self, tmp: str, images, **kwargs):
        return fetch_pixiv_tags(
            images,
            cache_path=Path(tmp) / "pixiv_tags.json",
            delay_seconds=0,
            **kwargs,
        )

    def test_skips_pids_with_successful_cache_entries(self):
        with TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "pixiv_tags.json"
            save_tag_cache({"111": TagCacheEntry(pid="111", tags=_tags("cached"), ok=True)}, cache_path)
            images = [_library_image("111"), _library_image("222")]
            with patch("pixiv_pbd_manager.resolver.fetch_artwork_tags", return_value=_tag_response("fresh")) as mock:
                result = self._run(tmp, images)

            self.assertEqual([call.args[0] for call in mock.call_args_list], ["222"])
        self.assertEqual((result.total, result.attempted, result.skipped), (2, 1, 1))
        self.assertEqual(result.fetched, 1)
        # The skipped image is still hydrated from the cache.
        self.assertEqual(images[0].pixiv_tags, _tags("cached"))
        self.assertEqual(images[1].pixiv_tags, _tags("fresh"))

    def test_retries_failed_cache_entries(self):
        with TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "pixiv_tags.json"
            save_tag_cache({"111": TagCacheEntry(pid="111", ok=False, error="404")}, cache_path)
            with patch("pixiv_pbd_manager.resolver.fetch_artwork_tags", return_value=_tag_response("fresh")) as mock:
                result = self._run(tmp, [_library_image("111")])
            entry = load_tag_cache(cache_path)["111"]

        self.assertEqual(mock.call_count, 1)
        self.assertEqual(result.attempted, 1)
        self.assertTrue(entry.ok)
        self.assertEqual(entry.tags, _tags("fresh"))
        self.assertEqual(entry.attempts, 1)

    def test_force_ignores_the_cache(self):
        with TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "pixiv_tags.json"
            save_tag_cache(
                {
                    "111": TagCacheEntry(pid="111", tags=_tags("old"), ok=True),
                    "222": TagCacheEntry(pid="222", tags=_tags("old"), ok=True),
                },
                cache_path,
            )
            images = [_library_image("111"), _library_image("222")]
            with patch("pixiv_pbd_manager.resolver.fetch_artwork_tags", return_value=_tag_response("new")) as mock:
                result = self._run(tmp, images, force=True)

        self.assertEqual(mock.call_count, 2)
        self.assertEqual((result.attempted, result.skipped, result.fetched), (2, 0, 2))
        self.assertEqual(images[0].pixiv_tags, _tags("new"))

    def test_seeds_from_catalog_and_makes_no_requests(self):
        # The upgrade path: no sidecar yet, but the catalog already holds tags.
        with TemporaryDirectory() as tmp:
            images = [_library_image("111", pixiv_tags=_tags("a")), _library_image("222", pixiv_tags=_tags("b"))]
            with patch("pixiv_pbd_manager.resolver.fetch_artwork_tags", side_effect=AssertionError("network")):
                result = self._run(tmp, images)
            cache = load_tag_cache(Path(tmp) / "pixiv_tags.json")

        self.assertEqual((result.seeded, result.attempted, result.skipped), (2, 0, 2))
        self.assertEqual(sorted(cache), ["111", "222"])
        self.assertEqual(cache["111"].source, "catalog")

    def test_hydrates_a_moved_file_without_fetching(self):
        with TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "pixiv_tags.json"
            save_tag_cache({"111": TagCacheEntry(pid="111", tags=_tags("kept"), ok=True)}, cache_path)
            moved = _library_image("111", name="renamed by hand.jpg")
            flushed: list[dict[str, list[dict[str, str]]]] = []
            with patch("pixiv_pbd_manager.resolver.fetch_artwork_tags", side_effect=AssertionError("network")):
                result = self._run(tmp, [moved], on_flush=flushed.append)

        self.assertEqual(result.attempted, 0)
        self.assertEqual(moved.pixiv_tags, _tags("kept"))
        # Hydration alone must still reach the catalog, or the recovery is lost.
        self.assertEqual(flushed, [{"111": _tags("kept")}])

    def test_records_failure_and_continues(self):
        with TemporaryDirectory() as tmp:
            with patch(
                "pixiv_pbd_manager.resolver.fetch_artwork_tags",
                side_effect=[PixivResolveError("nope"), _tag_response("ok")],
            ):
                result = self._run(tmp, [_library_image("111"), _library_image("222")])
            cache = load_tag_cache(Path(tmp) / "pixiv_tags.json")

        self.assertEqual((result.fetched, result.failed), (1, 1))
        self.assertEqual(result.errors, ["111: nope"])
        self.assertFalse(cache["111"].ok)
        self.assertEqual(cache["111"].error, "nope")
        self.assertTrue(cache["222"].ok)

    def test_failure_does_not_erase_existing_tags(self):
        with TemporaryDirectory() as tmp:
            image = _library_image("111", pixiv_tags=_tags("existing"))
            with patch("pixiv_pbd_manager.resolver.fetch_artwork_tags", side_effect=PixivResolveError("nope")):
                self._run(tmp, [image], force=True)
        self.assertEqual(image.pixiv_tags, _tags("existing"))

    def test_flushes_every_n_pids(self):
        with TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "pixiv_tags.json"
            seen_on_disk: list[list[str]] = []

            def fake_fetch(pid, **_kwargs):
                seen_on_disk.append(sorted(load_tag_cache(cache_path)))
                return _tag_response(f"t{pid}")

            images = [_library_image(str(100 + n)) for n in range(5)]
            flushed: list[dict[str, list[dict[str, str]]]] = []
            with patch("pixiv_pbd_manager.resolver.fetch_artwork_tags", side_effect=fake_fetch):
                self._run(tmp, images, flush_every=2, on_flush=flushed.append)

        # By the 3rd request the first two pids are already durable on disk,
        # so a crash here would not throw away the work already paid for.
        self.assertEqual(seen_on_disk[0], [])
        self.assertEqual(seen_on_disk[2], ["100", "101"])
        self.assertEqual(seen_on_disk[4], ["100", "101", "102", "103"])
        self.assertEqual(len(flushed), 3)  # 2 mid-run + 1 final

    def test_cancel_persists_partial_results(self):
        with TemporaryDirectory() as tmp:
            calls: list[str] = []

            def fake_fetch(pid, **_kwargs):
                calls.append(pid)
                return _tag_response("t")

            images = [_library_image("111"), _library_image("222"), _library_image("333")]
            with patch("pixiv_pbd_manager.resolver.fetch_artwork_tags", side_effect=fake_fetch):
                result = self._run(tmp, images, should_cancel=lambda: len(calls) >= 1)
            cache = load_tag_cache(Path(tmp) / "pixiv_tags.json")

        self.assertTrue(result.cancelled)
        self.assertEqual(result.fetched, 1)
        self.assertEqual(sorted(cache), ["111"])

    def test_does_not_clobber_entries_written_concurrently(self):
        with TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "pixiv_tags.json"

            def fake_fetch(pid, **_kwargs):
                # Another process finishes its own fetch while this run is mid-flight.
                other = load_tag_cache(cache_path)
                other["999"] = TagCacheEntry(pid="999", tags=_tags("other"), ok=True, fetched_at=10.0)
                save_tag_cache(other, cache_path)
                return _tag_response("mine")

            with patch("pixiv_pbd_manager.resolver.fetch_artwork_tags", side_effect=fake_fetch):
                self._run(tmp, [_library_image("111")])
            cache = load_tag_cache(cache_path)

        self.assertEqual(sorted(cache), ["111", "999"])

    def test_ignores_images_without_a_pid(self):
        with TemporaryDirectory() as tmp:
            with patch("pixiv_pbd_manager.resolver.fetch_artwork_tags", side_effect=AssertionError("network")):
                result = self._run(tmp, [_library_image("", name="not-pixiv.jpg")])
        self.assertEqual((result.total, result.attempted), (0, 0))

    def test_emits_counter_payloads_with_compat_aliases(self):
        events: list[tuple[str, dict]] = []
        with TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "pixiv_tags.json"
            save_tag_cache({"111": TagCacheEntry(pid="111", tags=_tags("cached"), ok=True)}, cache_path)
            images = [_library_image("111"), _library_image("222")]
            with patch("pixiv_pbd_manager.resolver.fetch_artwork_tags", return_value=_tag_response("fresh")):
                self._run(tmp, images, progress_callback=lambda key, payload: events.append((key, payload)))

        by_key = {key: payload for key, payload in events}
        start = by_key["progress_fetch_tags_start"]
        self.assertEqual((start["total"], start["total_pids"], start["skipped"]), (1, 2, 1))
        item = by_key["progress_fetch_tags_item"]
        self.assertEqual((item["fetched"], item["failed"]), (1, 0))
        done = by_key["progress_fetch_tags_done"]
        self.assertEqual((done["fetched"], done["skipped"], done["cached"]), (1, 1, 2))
        # Aliases the existing frontend log lines still read.
        self.assertEqual(done["updated"], done["fetched"])
        self.assertEqual(done["errors"], done["failed"])


if __name__ == "__main__":
    unittest.main()
