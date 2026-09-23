from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from pixiv_pbd_manager.database import ArtistDatabase
from pixiv_pbd_manager.operations import apply_scan_changes, preview_scan_changes, scan_into_database
from pixiv_pbd_manager.resolver import ResolvedArtist


class ScanRecognitionTests(unittest.TestCase):
    def setUp(self):
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        # Windows runners may expose TEMP through an 8.3 alias (RUNNER~1).
        # Scanner results intentionally use resolved, long-form paths.
        self.base = Path(tmp.name).resolve()
        self.root = self.base / "library"
        self.db = ArtistDatabase.load(self.base / "artists.json")

    def image(self, relative, *, root=None):
        path = (root or self.root) / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()
        return path

    def test_uid_artist_retains_every_directory_in_preview_apply_and_direct_scan(self):
        first = self.image("part-a/Artist-555666/10000001_p0.jpg")
        second = self.image("part-b/Artist-555666/10000002_p0.jpg")
        expected_paths = {str(first.parent), str(second.parent)}
        result = preview_scan_changes([self.root], self.db.path)
        self.assertEqual(len(result.changes), 1)
        self.assertEqual(set(result.changes[0]["save_paths"]), expected_paths)
        self.assertEqual(result.changes[0]["work_ids"], ["10000001", "10000002"])
        self.assertFalse(self.db.path.exists(), "preview must not write the database")
        directory_hits = result.summary.artist_folder_hits.values()
        self.assertEqual(
            {hit.folder: hit.work_ids for hit in directory_hits},
            {
                first.parent: {"10000001"},
                second.parent: {"10000002"},
            },
        )

        apply_scan_changes(self.db.path, result.changes)
        artist = ArtistDatabase.load(self.db.path).artists["555666"]
        self.assertEqual(set(artist.save_paths), expected_paths)
        self.assertEqual(set(artist.work_ids), {"10000001", "10000002"})
        direct_path = self.base / "direct.json"
        scan_into_database([self.root], direct_path)
        self.assertEqual(set(ArtistDatabase.load(direct_path).artists["555666"].save_paths), expected_paths)
        self.assertEqual(preview_scan_changes([self.root], self.db.path).changes, [])

    def test_rescanning_uid_artist_proposes_new_directory(self):
        first = self.image("part-a/Artist-555666/10000001_p0.jpg")
        self.db.upsert("555666", name="Artist", source="manual", save_path=first.parent, work_ids={"10000001"})
        self.db.save()
        second = self.image("part-b/Artist-555666/10000002_p0.jpg")
        changes = preview_scan_changes([self.root], self.db.path).changes
        paths = next(change for change in changes if change["kind"] == "add_save_paths")
        self.assertEqual(paths["paths"], [str(second.parent)])
        self.assertEqual(paths["artist_id"], "555666")

    def test_same_name_folders_under_different_roots_keep_separate_evidence(self):
        roots = [self.base / "disk-a", self.base / "disk-b"]
        first = self.image("Artist - pixiv/20000001_p0.jpg", root=roots[0])
        second = self.image("Artist - pixiv/20000002_p0.jpg", root=roots[1])
        for same_author in (False, True):
            with self.subTest(same_author=same_author):
                authors = {
                    "20000001": ResolvedArtist("111111", "Artist", "20000001"),
                    "20000002": ResolvedArtist("111111" if same_author else "222222", "Artist", "20000002"),
                }
                with patch(
                    "pixiv_pbd_manager.resolver.fetch_artwork_author", side_effect=lambda pid, **kwargs: authors[pid]
                ) as fetch:
                    result = preview_scan_changes(roots, self.db.path, resolve_online=True, resolve_delay=0)
                self.assertEqual(fetch.call_count, 2)
                self.assertEqual(len(result.summary.name_only_artists), 2)
                self.assertEqual(len(result.changes), 1 if same_author else 2)
                self.assertEqual(
                    {p for c in result.changes for p in c["save_paths"]}, {str(first.parent), str(second.parent)}
                )
                if not same_author:
                    self.assertEqual(
                        {c["artist_id"]: c["work_ids"] for c in result.changes},
                        {
                            "111111": ["20000001"],
                            "222222": ["20000002"],
                        },
                    )

    def test_known_pid_owner_wins_over_even_an_exact_name(self):
        image = self.image("Bob - pixiv/30000002_p0.jpg")
        self.db.upsert("111111", name="Bob", source="manual", work_ids={"30000001"})
        self.db.upsert("222222", name="Robert", source="manual", work_ids={"30000002"})
        self.db.save()
        with patch("pixiv_pbd_manager.resolver.resolve_name_only_artist") as online:
            changes = preview_scan_changes([self.root], self.db.path, resolve_online=True).changes
        online.assert_not_called()
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]["kind"], "add_save_paths")
        self.assertEqual(changes[0]["artist_id"], "222222")
        self.assertEqual(changes[0]["paths"], [str(image.parent)])

    def test_shared_display_suffix_does_not_create_an_offline_match(self):
        image = self.image("Bob@commission - pixiv/30000002_p0.jpg")
        self.db.upsert("111111", name="Alice@commission", source="manual", work_ids={"30000001"})
        self.db.save()
        result = preview_scan_changes([self.root], self.db.path)
        self.assertEqual(result.changes, [])
        self.assertIn(str(image.parent), result.summary.unmatched_folders)
        with patch(
            "pixiv_pbd_manager.resolver.fetch_artwork_author", return_value=ResolvedArtist("222222", "Bob", "30000002")
        ) as fetch:
            online = preview_scan_changes([self.root], self.db.path, resolve_online=True)
        fetch.assert_called_once()
        self.assertEqual(online.changes[0]["artist_id"], "222222")

    def test_unique_complete_name_still_matches_offline(self):
        image = self.image("Alice - pixiv/30000002_p0.jpg")
        self.db.upsert("111111", name="alice", source="manual")
        self.db.save()
        result = preview_scan_changes([self.root], self.db.path)
        self.assertTrue(result.changes)
        self.assertTrue(all(change["artist_id"] == "111111" for change in result.changes))
        self.assertIn(str(image.parent), result.summary.unmatched_folders)
        apply_scan_changes(self.db.path, result.changes)
        self.assertNotIn(str(image.parent), preview_scan_changes([self.root], self.db.path).summary.unmatched_folders)

    def test_ambiguous_complete_name_does_not_match_offline(self):
        image = self.image("Alice - pixiv/30000002_p0.jpg")
        for artist_id in ("111111", "222222"):
            self.db.upsert(artist_id, name="Alice", source="manual")
        self.db.save()
        result = preview_scan_changes([self.root], self.db.path)
        self.assertEqual(result.changes, [])
        self.assertIn(str(image.parent), result.summary.unmatched_folders)

    def test_known_conflicting_pids_do_not_fall_back_to_online_or_name_search(self):
        for folder in ("Alice - pixiv", "mixed"):
            self.image(f"{folder}/40000001_p0.jpg")
            self.image(f"{folder}/40000002_p0.jpg")
        self.db.upsert("111111", name="Alice", source="manual", work_ids={"40000001"})
        self.db.upsert("222222", name="Bob", source="manual", work_ids={"40000002"})
        self.db.save()
        with (
            patch("pixiv_pbd_manager.resolver.resolve_name_only_artist") as online,
            patch("pixiv_pbd_manager.resolver.resolve_name_by_fuzzy_search") as fuzzy,
        ):
            result = preview_scan_changes([self.root], self.db.path, resolve_online=True, fuzzy_search_names=True)
        online.assert_not_called()
        fuzzy.assert_not_called()
        self.assertEqual(result.changes, [])
        self.assertEqual(
            set(result.summary.unmatched_folders), {str(self.root / "Alice - pixiv"), str(self.root / "mixed")}
        )

    def test_online_author_conflict_blocks_majority_assignment_and_fuzzy_fallback(self):
        for folder in ("Alice - pixiv", "mixed"):
            for pid in ("40000001", "40000002", "40000003"):
                self.image(f"{folder}/{pid}_p0.jpg")
        authors = {
            "40000001": ResolvedArtist("111111", "Alice", "40000001"),
            "40000002": ResolvedArtist("222222", "Bob", "40000002"),
            "40000003": ResolvedArtist("111111", "Alice", "40000003"),
        }
        with (
            patch("pixiv_pbd_manager.resolver.fetch_artwork_author", side_effect=lambda pid, **kwargs: authors[pid]),
            patch("pixiv_pbd_manager.resolver.resolve_name_by_fuzzy_search") as fuzzy,
        ):
            result = preview_scan_changes(
                [self.root], self.db.path, resolve_online=True, resolve_delay=0, fuzzy_search_names=True
            )
            direct = scan_into_database(
                [self.root], self.db.path, resolve_online=True, resolve_delay=0, fuzzy_search_names=True
            )
        fuzzy.assert_not_called()
        self.assertEqual(result.changes, [])
        self.assertEqual(len(result.resolve_errors), 2)
        self.assertEqual(
            set(result.summary.unmatched_folders), {str(self.root / "Alice - pixiv"), str(self.root / "mixed")}
        )
        self.assertEqual(direct.changed, 0)
        self.assertEqual(ArtistDatabase.load(self.db.path).artists, {})


if __name__ == "__main__":
    unittest.main()
