import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pixiv_pbd_manager.downloader import (
    RESTRICTED_SUBDIR,
    PixivPage,
    download_artwork,
    download_binary,
    extension_from_url,
    fetch_artwork_pages,
    safe_filename,
)
from pixiv_pbd_manager.database import ArtistDatabase
from pixiv_pbd_manager.operations import apply_scan_changes, collect_local_work_ids, preview_scan_changes, scan_into_database
from pixiv_pbd_manager.scanner import scan_roots
from pixiv_pbd_manager.resolver import PixivResolveError


class DownloaderTests(unittest.TestCase):
    def test_safe_filename_replaces_windows_invalid_chars(self):
        self.assertEqual(safe_filename('a:b*c?d.jpg'), "a_b_c_d.jpg")

    def test_extension_from_url(self):
        self.assertEqual(extension_from_url("https://i.pximg.net/img-original/foo.png"), ".png")

    def test_fetch_artwork_pages_passes_cookie_through(self):
        captured = {}

        def fake_read(url, **kwargs):
            captured["url"] = url
            captured["cookie"] = kwargs.get("cookie")
            return ('{"body": [{"urls": {"original": "https://i.pximg.net/x_p0.jpg"}}]}', False)

        with patch("pixiv_pbd_manager.downloader.read_url_text_with_ssl_fallback", side_effect=fake_read):
            pages, _ = fetch_artwork_pages("12345", pixiv_cookie="PHPSESSID=abc")

        self.assertEqual(captured["cookie"], "PHPSESSID=abc")
        self.assertEqual(len(pages), 1)
        self.assertEqual(pages[0].original_url, "https://i.pximg.net/x_p0.jpg")

    def test_fetch_artwork_pages_surfaces_pixiv_message(self):
        def fake_read(url, **kwargs):
            return ('{"error": true, "message": "作品が見つかりません"}', False)

        with patch("pixiv_pbd_manager.downloader.read_url_text_with_ssl_fallback", side_effect=fake_read):
            with self.assertRaises(PixivResolveError) as ctx:
                fetch_artwork_pages("12345")

        self.assertIn("作品が見つかりません", str(ctx.exception))

    def test_download_binary_reports_progress_and_writes_file(self):
        class FakeImageResponse:
            headers = {"Content-Length": "6"}

            def __init__(self):
                self.chunks = [b"abc", b"def", b""]

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _size):
                return self.chunks.pop(0)

        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "image.jpg"
            events = []
            with patch("urllib.request.urlopen", return_value=FakeImageResponse()):
                ssl_used = download_binary(
                    "https://i.pximg.net/x.jpg",
                    output,
                    referer="https://www.pixiv.net/artworks/1",
                    progress_callback=lambda downloaded, total, speed: events.append((downloaded, total, speed)),
                )

            self.assertFalse(ssl_used)
            self.assertEqual(output.read_bytes(), b"abcdef")
            self.assertEqual(events[-1][0], 6)
            self.assertEqual(events[-1][1], 6)
            self.assertGreater(events[-1][2], 0)

    def test_download_artwork_routes_restricted_into_subfolder(self):
        page = PixivPage(index=0, original_url="https://i.pximg.net/x_p0.jpg")
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            with patch("pixiv_pbd_manager.downloader.fetch_artwork_xrestrict", return_value=(1, False)), patch(
                "pixiv_pbd_manager.downloader.fetch_artwork_pages", return_value=([page], False)
            ), patch("pixiv_pbd_manager.downloader.download_binary", return_value=False):
                result = download_artwork("123", target, separate_restricted=True, delay_seconds=0)
            self.assertIsNone(result.error)
            self.assertEqual(Path(result.saved_files[0]).parent.name, RESTRICTED_SUBDIR)

    def test_download_artwork_keeps_allages_in_base_folder(self):
        page = PixivPage(index=0, original_url="https://i.pximg.net/x_p0.jpg")
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            with patch("pixiv_pbd_manager.downloader.fetch_artwork_xrestrict", return_value=(0, False)), patch(
                "pixiv_pbd_manager.downloader.fetch_artwork_pages", return_value=([page], False)
            ), patch("pixiv_pbd_manager.downloader.download_binary", return_value=False):
                result = download_artwork("123", target, separate_restricted=True, delay_seconds=0)
            self.assertEqual(Path(result.saved_files[0]).parent, target)


class ScanPreviewApplyTests(unittest.TestCase):
    def _seed_db(self, db_path: Path, *, artist_id: str, name: str, work_ids: set[str]) -> None:
        db = ArtistDatabase.load(db_path)
        db.upsert(artist_id, name=name, source="manual", work_ids=work_ids)
        db.save()

    def test_preview_reports_name_change_and_new_works_without_writing(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            db_path = base / "db.json"
            self._seed_db(db_path, artist_id="12345", name="ManualName", work_ids={"111111"})
            (base / "Existing-12345").mkdir()
            (base / "Existing-12345" / "222222_p0.jpg").write_bytes(b"x")
            (base / "NewGuy-67890").mkdir()
            (base / "NewGuy-67890" / "333333_p0.jpg").write_bytes(b"x")

            preview = preview_scan_changes([base], db_path)
            kinds = {change["kind"] for change in preview.changes}
            self.assertIn("new_artist", kinds)
            self.assertIn("name_change", kinds)
            self.assertIn("add_work_ids", kinds)
            # Preview must not have touched the DB on disk.
            db_after = ArtistDatabase.load(db_path)
            self.assertEqual(db_after.artists["12345"].name, "ManualName")
            self.assertEqual(sorted(db_after.artists["12345"].work_ids), ["111111"])
            self.assertNotIn("67890", db_after.artists)

    def test_apply_preserves_name_when_name_change_not_selected(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            db_path = base / "db.json"
            self._seed_db(db_path, artist_id="12345", name="ManualName", work_ids={"111111"})
            (base / "Existing-12345").mkdir()
            (base / "Existing-12345" / "222222_p0.jpg").write_bytes(b"x")
            (base / "NewGuy-67890").mkdir()
            (base / "NewGuy-67890" / "333333_p0.jpg").write_bytes(b"x")

            preview = preview_scan_changes([base], db_path)
            # Default subset: new_artist + add_work_ids; leave name_change/add_save_paths out.
            selected = [c for c in preview.changes if c["kind"] in {"new_artist", "add_work_ids"}]
            result = apply_scan_changes(db_path, selected)
            self.assertEqual(result.name_changes, 0)
            self.assertGreaterEqual(result.new_artists, 1)
            db_after = ArtistDatabase.load(db_path)
            self.assertEqual(db_after.artists["12345"].name, "ManualName")
            self.assertIn("222222", db_after.artists["12345"].work_ids)
            self.assertIn("67890", db_after.artists)

    def test_preview_does_not_recreate_manually_replaced_artist_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            db_path = base / "db.json"
            db = ArtistDatabase.load(db_path)
            db.upsert("99999", name="Kiri", source="manual", work_ids={"111111"})
            db.artists["99999"].sources.append("manual_id_edit:2632562->99999")
            db.save()
            (base / "OldResolved-2632562").mkdir()
            (base / "OldResolved-2632562" / "222222_p0.jpg").write_bytes(b"x")

            preview = preview_scan_changes([base], db_path)

            self.assertFalse(
                any(change["kind"] == "new_artist" and change["artist_id"] == "2632562" for change in preview.changes)
            )
            add_work = [change for change in preview.changes if change["kind"] == "add_work_ids"]
            self.assertEqual(add_work[0]["artist_id"], "99999")
            self.assertEqual(add_work[0]["work_ids"], ["222222"])

    def test_preview_does_not_recreate_artist_when_save_path_is_already_known(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            db_path = base / "db.json"
            folder = base / "OldResolved-2632562"
            folder.mkdir()
            (folder / "222222_p0.jpg").write_bytes(b"x")
            db = ArtistDatabase.load(db_path)
            db.upsert("99999", name="Kiri", source="manual", save_path=folder, work_ids={"111111"})
            db.save()

            preview = preview_scan_changes([base], db_path)

            self.assertFalse(
                any(change["kind"] == "new_artist" and change["artist_id"] == "2632562" for change in preview.changes)
            )
            add_work = [change for change in preview.changes if change["kind"] == "add_work_ids"]
            self.assertEqual(add_work[0]["artist_id"], "99999")
            self.assertEqual(add_work[0]["work_ids"], ["222222"])

    def test_preview_redirects_recognized_subfolder_under_known_save_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            db_path = base / "db.json"
            assigned = base / "kiri"
            subfolder = assigned / "Archive-2632562"
            subfolder.mkdir(parents=True)
            (subfolder / "222222_p0.jpg").write_bytes(b"x")
            db = ArtistDatabase.load(db_path)
            db.upsert("99999", name="Kiri", source="manual", save_path=assigned, work_ids={"111111"})
            db.save()

            preview = preview_scan_changes([base], db_path)

            self.assertFalse(
                any(change["kind"] == "new_artist" and change["artist_id"] == "2632562" for change in preview.changes)
            )
            self.assertFalse(any(change["kind"] == "add_save_paths" for change in preview.changes))
            add_work = [change for change in preview.changes if change["kind"] == "add_work_ids"]
            self.assertEqual(add_work[0]["artist_id"], "99999")
            self.assertEqual(add_work[0]["work_ids"], ["222222"])

    def test_preview_hides_unmatched_folders_under_known_save_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            db_path = base / "db.json"
            assigned = base / "kiri"
            loose_subfolder = assigned / "misc"
            unassigned = base / "random"
            loose_subfolder.mkdir(parents=True)
            unassigned.mkdir()
            (loose_subfolder / "note_image.jpg").write_bytes(b"x")
            (unassigned / "note_image.jpg").write_bytes(b"y")
            db = ArtistDatabase.load(db_path)
            db.upsert("99999", name="Kiri", source="manual", save_path=assigned)
            db.save()

            preview = preview_scan_changes([base], db_path)

            unmatched_paths = {item for item in preview.summary.unmatched_folders}
            self.assertNotIn(str(loose_subfolder.resolve()), unmatched_paths)
            self.assertIn(str(unassigned.resolve()), unmatched_paths)

    def test_scan_into_database_does_not_recreate_manually_replaced_artist_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            db_path = base / "db.json"
            db = ArtistDatabase.load(db_path)
            db.upsert("99999", name="Kiri", source="manual", work_ids={"111111"})
            db.artists["99999"].sources.append("manual_id_edit:2632562->99999")
            db.save()
            (base / "OldResolved-2632562").mkdir()
            (base / "OldResolved-2632562" / "222222_p0.jpg").write_bytes(b"x")

            scan_into_database([base], db_path)
            db_after = ArtistDatabase.load(db_path)

            self.assertNotIn("2632562", db_after.artists)
            self.assertIn("222222", db_after.artists["99999"].work_ids)

    def test_scan_into_database_redirects_subfolder_under_known_save_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            db_path = base / "db.json"
            assigned = base / "kiri"
            subfolder = assigned / "Archive-2632562"
            subfolder.mkdir(parents=True)
            (subfolder / "222222_p0.jpg").write_bytes(b"x")
            db = ArtistDatabase.load(db_path)
            db.upsert("99999", name="Kiri", source="manual", save_path=assigned, work_ids={"111111"})
            db.save()

            scan_into_database([base], db_path)
            db_after = ArtistDatabase.load(db_path)

            self.assertNotIn("2632562", db_after.artists)
            self.assertIn("222222", db_after.artists["99999"].work_ids)
            self.assertEqual(db_after.artists["99999"].save_paths, [str(assigned.resolve())])


class UnmatchedFolderScopeTests(unittest.TestCase):
    def test_scan_root_itself_is_not_listed_as_unmatched(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            # Loose file at the scan root (no artist folder around it).
            (root / "loose.jpg").write_bytes(b"x")
            # Subfolder with no artist id, deeper than the root.
            sub = root / "randomstuff"
            sub.mkdir()
            (sub / "image.jpg").write_bytes(b"y")

            summary = scan_roots([root])

            self.assertNotIn(str(root), summary.unmatched_folders)
            self.assertIn(str(sub), summary.unmatched_folders)


class LocalWorkIdScanTests(unittest.TestCase):
    def test_collect_local_work_ids_includes_subfolders(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            (base / "sub").mkdir()
            (base / "111111_p0.jpg").write_bytes(b"x")
            (base / "sub" / "222222_p0.jpg").write_bytes(b"x")
            ids = collect_local_work_ids([str(base)])
        self.assertEqual(ids, {"111111", "222222"})


if __name__ == "__main__":
    unittest.main()
