from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from pixiv_pbd_manager.database import ArtistDatabase
from pixiv_pbd_manager.gui_api.commands import scan as scan_commands
from pixiv_pbd_manager.operations import apply_scan_changes, preview_scan_changes
from pixiv_pbd_manager.resolver import ResolvedArtist


class UnappliedScanTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name).resolve()
        (self.base / ".pixiv-pbd-manager").mkdir()
        self.root = self.base / "library"
        self.db = ArtistDatabase.load(self.base / "artists.json")

    def image(self, relative):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()
        return path

    def preview(self, **kwargs):
        return preview_scan_changes([self.root], self.db.path, **kwargs)

    def test_uid_candidates_remain_until_selected_paths_are_applied(self):
        first = self.image("\u7532-555666/10000001_p0.jpg").parent
        self.image("\u7532-555666/10000001_p1.jpg")
        self.image("\u7532-555666/sub/10000002_p0.jpg")
        second = self.image("\u4e59-777888/20000001_p0.jpg").parent
        unmatched = self.image("misc/image.jpg").parent
        preview = self.preview()
        self.assertEqual(preview.summary.unmatched_folders, {str(first): 3, str(second): 1, str(unmatched): 1})
        self.assertFalse(self.db.path.exists())
        self.assertEqual(self.preview().summary.unmatched_folders, preview.summary.unmatched_folders)

        selected = [change for change in preview.changes if change["artist_id"] == "555666"]
        result = apply_scan_changes(self.db.path, selected, unmatched_paths=list(preview.summary.unmatched_folders))
        self.assertEqual(result.assigned_folders, [str(first)])
        self.assertEqual(self.preview().summary.unmatched_folders, {str(second): 1, str(unmatched): 1})
        self.assertEqual(set(ArtistDatabase.load(self.db.path).artists), {"555666"})

    def test_online_name_and_plain_pid_candidates_remain_unassigned(self):
        for folder in ("Artist - pixiv", "plain"):
            with self.subTest(folder=folder):
                image = self.image(f"{folder}/10000001_p0.jpg")
                with patch(
                    "pixiv_pbd_manager.resolver.resolve_name_only_artist",
                    return_value=ResolvedArtist("555666", "Artist", "10000001"),
                ):
                    preview = self.preview(resolve_online=True)
                self.assertTrue(preview.changes)
                self.assertEqual(preview.summary.unmatched_folders[str(image.parent)], 1)
                self.assertFalse(self.db.path.exists())

    def test_only_work_ids_applied_does_not_assign_new_save_path(self):
        image = self.image("Artist-555666/10000001_p0.jpg")
        self.db.upsert("555666", name="Artist", source="manual")
        self.db.save()
        preview = self.preview()
        work_changes = [change for change in preview.changes if change["kind"] == "add_work_ids"]
        self.assertTrue(work_changes)
        result = apply_scan_changes(self.db.path, work_changes, unmatched_paths=[str(image.parent)])
        self.assertEqual(result.assigned_folders, [])
        self.assertEqual(self.preview().summary.unmatched_folders, {str(image.parent): 1})
        paths = [change for change in preview.changes if change["kind"] == "add_save_paths"]
        result = apply_scan_changes(self.db.path, paths, unmatched_paths=[str(image.parent)])
        self.assertEqual(result.assigned_folders, [str(image.parent)])
        self.assertEqual(self.preview().summary.unmatched_folders, {})

    def test_persisted_parent_hides_children_but_not_similarly_named_sibling(self):
        known = self.image("saved/sub/10000001_p0.jpg").parent.parent
        self.image("saved/Artist-555666/image.jpg")
        sibling = self.image("saved-other/image.jpg").parent
        excluded = self.image("excluded/Artist-777888/image.jpg").parent.parent
        self.db.upsert("555666", name="Artist", source="manual", save_path=known)
        self.db.save()
        preview = self.preview(exclude_roots=[excluded])
        self.assertEqual(preview.summary.unmatched_folders, {str(sibling): 1})

    def test_filename_uid_and_scan_root_pid_are_counted(self):
        named = self.image("plain/uid_555666_10000001_p0.jpg").parent
        self.image("20000001_p0.jpg")
        self.image("image.jpg")  # Keep the existing scan-root exclusion for files without PID evidence.
        preview = self.preview()
        self.assertEqual(preview.summary.unmatched_folders, {str(named): 1, str(self.root): 1})

    def test_failed_apply_leaves_database_and_candidates_unchanged(self):
        self.image("Artist-555666/10000001_p0.jpg")
        preview = self.preview()
        with patch.object(ArtistDatabase, "save", side_effect=OSError("disk full")):
            with self.assertRaisesRegex(OSError, "disk full"):
                apply_scan_changes(self.db.path, preview.changes, unmatched_paths=list(preview.summary.unmatched_folders))
        self.assertFalse(self.db.path.exists())
        self.assertEqual(self.preview().summary.unmatched_folders, preview.summary.unmatched_folders)

    def test_apply_command_reports_only_persisted_assignments(self):
        first = self.image("Artist-555666/10000001_p0.jpg").parent
        second = self.image("Other-777888/20000001_p0.jpg").parent
        payload = {
            "project_root": str(self.base), "database": str(self.db.path),
            "roots": [str(self.root)], "resolve_online": False,
        }
        preview = scan_commands.preview(payload, lambda event: None)
        self.assertEqual({folder["path"] for folder in preview["unmatched_folders"]}, {str(first), str(second)})
        result = scan_commands.apply({
            **payload,
            "operations": [change for change in preview["changes"] if change["artist_id"] == "555666"],
            "unmatched_paths": [str(first), str(first / "sub"), str(second)],
        }, lambda event: None)
        self.assertEqual(set(result["assigned_folders"]), {str(first), str(first / "sub")})
        self.assertEqual([artist["id"] for artist in result["artists"]], ["555666"])

    def test_apply_command_rejects_invalid_paths_before_writing(self):
        for value in ("invalid", [None], [123], [""]):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "unmatched_paths"):
                scan_commands.apply({
                    "project_root": str(self.base), "database": str(self.db.path),
                    "operations": [], "unmatched_paths": value,
                }, lambda event: None)
        self.assertFalse(self.db.path.exists())


if __name__ == "__main__":
    unittest.main()
