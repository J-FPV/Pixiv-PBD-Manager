from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from pixiv_pbd_manager.scanner import (
    identify_artist,
    identify_name_only_artist,
    iter_media_files,
    scan_roots,
)


class ScannerTests(unittest.TestCase):
    def test_identifies_default_pbd_folder(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "pixiv" / "Some Artist-123456" / "98765432-title.jpg"
            path.parent.mkdir(parents=True)
            path.write_bytes(b"")

            hit = identify_artist(path, root)

            self.assertIsNotNone(hit)
            assert hit is not None
            self.assertEqual(hit.artist_id, "123456")
            self.assertEqual(hit.artist_name, "Some Artist")
            self.assertIn("98765432", hit.work_ids)

    def test_identifies_keyword_in_filename(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "98765432_user_id_456789_title.png"
            path.write_bytes(b"")

            hit = identify_artist(path, root)

            self.assertIsNotNone(hit)
            assert hit is not None
            self.assertEqual(hit.artist_id, "456789")

    def test_scan_aggregates_artist_work_ids(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = root / "pixiv" / "A-111222" / "90000001-one.jpg"
            second = root / "pixiv" / "A-111222" / "90000002-two.jpg"
            first.parent.mkdir(parents=True)
            first.write_bytes(b"")
            second.write_bytes(b"")

            summary = scan_roots([root])

            self.assertEqual(summary.files_seen, 2)
            self.assertEqual(summary.files_matched, 2)
            self.assertEqual(set(summary.artists), {"111222"})
            self.assertEqual(summary.artists["111222"].work_ids, {"90000001", "90000002"})

    def test_scan_skips_excluded_folder(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            keep = root / "keep" / "Keep Artist-111222" / "90000001-one.jpg"
            skip = root / "skip" / "Skip Artist-333444" / "90000002-two.jpg"
            keep.parent.mkdir(parents=True)
            skip.parent.mkdir(parents=True)
            keep.write_bytes(b"")
            skip.write_bytes(b"")

            summary = scan_roots([root], exclude_roots=[root / "skip"])

            self.assertEqual(summary.files_seen, 1)
            self.assertEqual(summary.excluded_dirs, 1)
            self.assertEqual(set(summary.artists), {"111222"})

    def test_scan_skips_root_when_parent_is_excluded(self):
        with TemporaryDirectory() as tmp:
            parent = Path(tmp)
            root = parent / "library"
            path = root / "Artist-111222" / "90000001-one.jpg"
            path.parent.mkdir(parents=True)
            path.write_bytes(b"")

            summary = scan_roots([root], exclude_roots=[parent])

            self.assertEqual(summary.files_seen, 0)
            self.assertEqual(summary.excluded_dirs, 1)
            self.assertEqual(summary.artists, {})

    def test_identifies_name_only_pixiv_folder(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "96YOTTEA's illustrations／manga - pixiv" / "100187254_p0.jpg"
            path.parent.mkdir(parents=True)
            path.write_bytes(b"")

            hit = identify_name_only_artist(path, root)

            self.assertIsNotNone(hit)
            assert hit is not None
            self.assertEqual(hit.artist_name, "96YOTTEA")
            self.assertEqual(hit.work_ids, {"100187254"})

    def test_name_only_pixiv_folder_keeps_parentheses_in_name(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "Demahmw(代碼)'s illustrations／manga - pixiv" / "100187254_p0.jpg"
            path.parent.mkdir(parents=True)
            path.write_bytes(b"")

            hit = identify_name_only_artist(path, root)

            self.assertIsNotNone(hit)
            assert hit is not None
            self.assertEqual(hit.artist_name, "Demahmw(代碼)")

    def test_identifies_manual_illus_folder_artist_name(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "illus-一条レイ-赛璐璐-contrast color-dot" / "sample.jpg"
            path.parent.mkdir(parents=True)
            path.write_bytes(b"")

            hit = identify_name_only_artist(path, root)

            self.assertIsNotNone(hit)
            assert hit is not None
            self.assertEqual(hit.artist_name, "一条レイ")

    def test_date_prefixed_folder_is_not_mistaken_for_pid(self):
        # A fanbox-style nested folder ``2020-07-01-title`` previously matched
        # the leading-digits pattern with id=2020 (year). With the LOW_PID
        # threshold (3000) enabled by default, the year (2020 < 3000) is
        # rejected; the file falls through to the name-only detector and is
        # attributed under the outer ``illus-XX`` folder.
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = (
                root
                / "illus-カンザリン-impasto-H-laplace"
                / "fanbox"
                / "2020-07-01-シャニマス催眠エロ"
                / "file.jpg"
            )
            path.parent.mkdir(parents=True)
            path.write_bytes(b"")

            hit = identify_artist(path, root)
            self.assertIsNone(hit, "year prefix must not be parsed as an artist ID")

            name_only = identify_name_only_artist(path, root)
            self.assertIsNotNone(name_only)
            assert name_only is not None
            self.assertEqual(name_only.artist_name, "カンザリン")

    def test_low_pid_toggle_unlocks_old_4_digit_ids(self):
        # Users with very old Pixiv accounts (4-digit IDs registered in 2007)
        # can opt in to recognise IDs below the LOW_PID threshold.
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "1234 LegacyArtist" / "98765432-work.jpg"
            path.parent.mkdir(parents=True)
            path.write_bytes(b"")

            self.assertIsNone(identify_artist(path, root), "low IDs rejected by default")

            opted_in = identify_artist(path, root, allow_low_pids=True)
            self.assertIsNotNone(opted_in)
            assert opted_in is not None
            self.assertEqual(opted_in.artist_id, "1234")

    def test_iter_media_files_respects_max_depth(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "a.jpg").write_bytes(b"")
            (root / "level1").mkdir()
            (root / "level1" / "b.jpg").write_bytes(b"")
            (root / "level1" / "level2").mkdir()
            (root / "level1" / "level2" / "c.jpg").write_bytes(b"")

            unlimited = sorted(p.name for p in iter_media_files(root))
            self.assertEqual(unlimited, ["a.jpg", "b.jpg", "c.jpg"])

            depth0 = sorted(p.name for p in iter_media_files(root, max_depth=0))
            self.assertEqual(depth0, ["a.jpg"])

            depth1 = sorted(p.name for p in iter_media_files(root, max_depth=1))
            self.assertEqual(depth1, ["a.jpg", "b.jpg"])


if __name__ == "__main__":
    unittest.main()
