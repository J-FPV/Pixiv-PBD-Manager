import io
import json
import os
import subprocess
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from PIL import Image

from pixiv_pbd_manager import gui_api
from pixiv_pbd_manager.database import ArtistDatabase
from pixiv_pbd_manager.operations.updates import DownloadUpdatesResult
from pixiv_pbd_manager.resolver import PixivUserProfile


def invoke(command, payload=None):
    buf = io.StringIO()
    with redirect_stdout(buf):
        exit_code = gui_api.main([command, json.dumps(payload or {})])
    events = [json.loads(line) for line in buf.getvalue().splitlines()]
    return exit_code, events


def _isolate(directory) -> Path:
    """Create the `.pixiv-pbd-manager/` marker inside ``directory`` so that
    ``gui_api.resolve_base_dir`` treats it as a project root. Without this,
    the resolver would fall through to the real ``%APPDATA%/PixivPbdManager/``
    and the test would pollute the user's actual data."""
    path = Path(directory)
    (path / ".pixiv-pbd-manager").mkdir(exist_ok=True)
    return path


class GuiApiTests(unittest.TestCase):
    def test_settings_get_outputs_result_event(self):
        with TemporaryDirectory() as tmp:
            _isolate(tmp)
            old_cwd = Path.cwd()
            try:
                os.chdir(tmp)
                exit_code, events = invoke("settings.get")
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        self.assertEqual(events[-1]["type"], "result")
        self.assertIn("settings", events[-1]["payload"])
        self.assertIn("project_root", events[-1]["payload"])

    def test_settings_save_and_artists_list(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            settings = {
                "database": str(root / ".pixiv-pbd-manager" / "artists.json"),
                "download_roots": [str(root / "images")],
                "exclude_roots": [],
            }
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                save_code, save_events = invoke("settings.save", {"settings": settings})
                list_code, list_events = invoke("artists.list")
            finally:
                os.chdir(old_cwd)

        self.assertEqual(save_code, 0)
        self.assertEqual(save_events[-1]["payload"]["settings"]["database"], settings["database"])
        self.assertEqual(list_code, 0)
        self.assertEqual(list_events[-1]["payload"]["artists"], [])

    def test_cookie_revoke_clears_cookie_immediately(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                save_code, _save_events = invoke(
                    "settings.save",
                    {"settings": {}, "cookie_consent": True, "pixiv_cookie": "PHPSESSID=secret"},
                )
                revoke_code, revoke_events = invoke("cookie.revoke")
                cookie_bin_exists = (root / ".pixiv-pbd-manager" / "cookie.bin").exists()
                cookie_txt_exists = (root / ".pixiv-pbd-manager" / "cookie.txt").exists()
            finally:
                os.chdir(old_cwd)

        self.assertEqual(save_code, 0)
        self.assertEqual(revoke_code, 0)
        self.assertFalse(revoke_events[-1]["payload"]["cookie_consent"])
        self.assertFalse(cookie_bin_exists)
        self.assertFalse(cookie_txt_exists)

    def test_settings_get_repairs_legacy_mojibake_paths(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            library = root / "参考图"
            library.mkdir()
            mojibake_library = str(library).encode("utf-8").decode("gbk", errors="surrogateescape")
            settings_text = json.dumps({"download_roots": [mojibake_library]}, ensure_ascii=False)
            (root / ".pixiv-pbd-manager" / "gui_settings.json").write_bytes(
                settings_text.encode("utf-8", errors="backslashreplace")
            )
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                exit_code, events = invoke("settings.get")
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        self.assertEqual(events[-1]["payload"]["settings"]["download_roots"], [str(library)])

    def test_project_root_resolves_from_tauri_nested_directory(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            nested = root / "desktop" / "src-tauri"
            db_dir = root / ".pixiv-pbd-manager"
            nested.mkdir(parents=True)
            db_dir.mkdir()
            (root / "pixiv_pbd_manager").mkdir()
            (db_dir / "artists.json").write_text(
                json.dumps(
                    {
                        "version": 1,
                        "artists": {
                            "123456": {
                                "id": "123456",
                                "name": "Sample Artist",
                                "work_ids": ["987654"],
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )
            (db_dir / "gui_settings.json").write_text(
                json.dumps({"database": ".pixiv-pbd-manager/artists.json"}),
                encoding="utf-8",
            )
            old_cwd = Path.cwd()
            try:
                os.chdir(nested)
                exit_code, events = invoke("artists.list", {"project_root": ".."})
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        payload = events[-1]["payload"]
        self.assertEqual(payload["project_root"], str(root.resolve()))
        self.assertEqual(payload["db_path"], str((db_dir / "artists.json").resolve()))
        self.assertEqual(payload["artists"][0]["id"], "123456")

    def test_artists_add_can_store_save_path(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            save_path = root / "artist-folder"
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                exit_code, events = invoke(
                    "artists.add",
                    {"artist_id": "123456", "name": "Artist", "save_path": str(save_path)},
                )
                db = ArtistDatabase.load(root / ".pixiv-pbd-manager" / "artists.json")
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        self.assertEqual(events[-1]["type"], "result")
        self.assertEqual(events[-1]["payload"]["save_path"], str(save_path))
        self.assertEqual(db.artists["123456"].save_paths, [str(save_path.resolve())])

    def test_artists_set_favorite_persists_and_serializes(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                invoke("artists.add", {"artist_id": "123456", "name": "Artist"})
                exit_code, events = invoke("artists.set_favorite", {"artist_id": "123456", "favorite": True})
                _, list_events = invoke("artists.list", {})
                db = ArtistDatabase.load(root / ".pixiv-pbd-manager" / "artists.json")
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        self.assertEqual(events[-1]["type"], "result")
        self.assertTrue(events[-1]["payload"]["favorite"])
        self.assertTrue(db.artists["123456"].favorite)
        self.assertTrue(list_events[-1]["payload"]["artists"][0]["favorite"])

    def test_artists_set_tags_persists_and_serializes(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                invoke("artists.add", {"artist_id": "123456", "name": "Artist"})
                exit_code, events = invoke(
                    "artists.set_tags", {"artist_id": "123456", "tags": ["风景", " 人物 ", "风景"]}
                )
                _, list_events = invoke("artists.list", {})
                db = ArtistDatabase.load(root / ".pixiv-pbd-manager" / "artists.json")
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        self.assertEqual(events[-1]["payload"]["tags"], ["人物", "风景"])
        self.assertEqual(db.artists["123456"].tags, ["人物", "风景"])
        self.assertEqual(list_events[-1]["payload"]["artists"][0]["tags"], ["人物", "风景"])

    def test_tag_lifecycle_via_ipc(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                invoke("artists.add", {"artist_id": "123456", "name": "Artist"})
                invoke("artists.add", {"artist_id": "654321", "name": "Other"})
                invoke("artists.add_tag", {"name": "风景"})
                _, assign_events = invoke(
                    "artists.assign_tag", {"artist_ids": ["123456", "654321"], "name": "风景"}
                )
                invoke("artists.rename_tag", {"old": "风景", "new": "人物"})
                _, list_events = invoke("artists.list", {})
                _, delete_events = invoke("artists.delete_tag", {"name": "人物"})
                db = ArtistDatabase.load(root / ".pixiv-pbd-manager" / "artists.json")
            finally:
                os.chdir(old_cwd)

        self.assertEqual(assign_events[-1]["payload"]["assigned"], 2)
        # list reflects the rename across the global tag list and the artists.
        self.assertEqual(list_events[-1]["payload"]["tags"], ["人物"])
        self.assertTrue(all("人物" in a["tags"] for a in list_events[-1]["payload"]["artists"]))
        # delete clears it everywhere.
        self.assertEqual(delete_events[-1]["payload"]["tags"], [])
        self.assertEqual(db.artists["123456"].tags, [])

    def test_artists_add_fetches_name_when_empty(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                with patch(
                    "pixiv_pbd_manager.resolver.fetch_user_profile",
                    return_value=PixivUserProfile(id="123456", name="Online Artist"),
                ):
                    exit_code, events = invoke("artists.add", {"artist_id": "123456", "name": ""})
                db = ArtistDatabase.load(root / ".pixiv-pbd-manager" / "artists.json")
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        self.assertEqual(events[-1]["payload"]["name"], "Online Artist")
        self.assertEqual(db.artists["123456"].name, "Online Artist")

    def test_artists_assign_folder_records_save_path_and_local_work_ids(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            folder = root / "unmatched-folder"
            folder.mkdir()
            (folder / "987654_p0.jpg").write_bytes(b"fake")
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                with patch(
                    "pixiv_pbd_manager.resolver.fetch_user_profile",
                    return_value=PixivUserProfile(id="123456", name="Online Artist"),
                ):
                    exit_code, events = invoke(
                        "artists.assign_folder",
                        {"artist_id": "123456", "folder": str(folder)},
                    )
                db = ArtistDatabase.load(root / ".pixiv-pbd-manager" / "artists.json")
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        payload = events[-1]["payload"]
        self.assertEqual(payload["artist_id"], "123456")
        self.assertEqual(payload["work_ids"], 1)
        self.assertEqual(db.artists["123456"].name, "Online Artist")
        self.assertEqual(db.artists["123456"].save_paths, [str(folder.resolve())])
        self.assertEqual(db.artists["123456"].work_ids, ["987654"])

    def test_artists_remove_deletes_selected_records(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                db = ArtistDatabase.load(root / ".pixiv-pbd-manager" / "artists.json")
                db.upsert("111", name="First")
                db.upsert("222", name="Second")
                db.save()

                exit_code, events = invoke("artists.remove", {"artist_ids": ["111", "333"]})
                db = ArtistDatabase.load(root / ".pixiv-pbd-manager" / "artists.json")
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        self.assertEqual(events[-1]["payload"]["removed"], 1)
        self.assertEqual(events[-1]["payload"]["artist_ids"], ["111"])
        self.assertNotIn("111", db.artists)
        self.assertIn("222", db.artists)

    def test_artists_refresh_names_fetches_profile_names(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                db = ArtistDatabase.load(root / ".pixiv-pbd-manager" / "artists.json")
                db.upsert("123456", name="Broken Name")
                db.save()

                with patch(
                    "pixiv_pbd_manager.resolver.fetch_user_profile",
                    return_value=PixivUserProfile(id="123456", name="Online Artist"),
                ):
                    exit_code, events = invoke("artists.refresh_names", {"artist_ids": ["123456"]})
                db = ArtistDatabase.load(root / ".pixiv-pbd-manager" / "artists.json")
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        self.assertTrue(any(event.get("key") == "progress_refresh_names_artist" for event in events))
        payload = events[-1]["payload"]
        self.assertEqual(payload["changed"], 1)
        self.assertEqual(payload["artists"][0]["name"], "Online Artist")
        self.assertEqual(db.artists["123456"].name, "Online Artist")

    def test_subprocess_outputs_utf8_json_for_cjk_and_emoji_artist_names(self):
        repo_root = Path(__file__).resolve().parents[1]
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            data_dir = root / ".pixiv-pbd-manager"
            data_dir.mkdir()
            (data_dir / "gui_settings.json").write_text(
                json.dumps({"database": ".pixiv-pbd-manager/artists.json"}),
                encoding="utf-8",
            )
            (data_dir / "artists.json").write_text(
                json.dumps(
                    {
                        "version": 1,
                        "artists": {
                            "123456": {
                                "id": "123456",
                                "name": "一条レイ ✨",
                                "work_ids": ["987654"],
                            }
                        },
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            env = os.environ.copy()
            env["PYTHONPATH"] = str(repo_root) + os.pathsep + env.get("PYTHONPATH", "")
            completed = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "pixiv_pbd_manager.gui_api",
                    "artists.list",
                    json.dumps({"project_root": str(root)}),
                ],
                cwd=root,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

        stderr = completed.stderr.decode("utf-8", errors="replace")
        self.assertEqual(completed.returncode, 0, stderr)
        events = [json.loads(line) for line in completed.stdout.decode("utf-8").splitlines()]
        self.assertEqual(events[-1]["payload"]["artists"][0]["name"], "一条レイ ✨")

    def test_scan_run_emits_progress_and_result(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            library = root / "library"
            artist_dir = library / "Artist-123456"
            artist_dir.mkdir(parents=True)
            (artist_dir / "987654_p0.jpg").write_bytes(b"fake")
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                exit_code, events = invoke(
                    "scan.run",
                    {
                        "roots": [str(library)],
                        "db_path": str(root / ".pixiv-pbd-manager" / "artists.json"),
                        "resolve_online": False,
                    },
                )
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        self.assertTrue(any(event["type"] == "progress" for event in events))
        self.assertEqual(events[-1]["type"], "result")
        self.assertEqual(events[-1]["payload"]["artists"], 1)

    def test_similar_run_outputs_duplicate_groups(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            first = root / "first.png"
            second = root / "second.png"
            Image.new("RGB", (32, 32), "red").save(first)
            second.write_bytes(first.read_bytes())
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                exit_code, events = invoke("similar.run", {"roots": [str(root)], "threshold": "likely"})
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        payload = events[-1]["payload"]
        self.assertEqual(len(payload["groups"]), 1)
        self.assertEqual(payload["groups"][0]["kind"], "exact")

    def test_similar_run_empty_excludes_do_not_fall_back_to_scan_excludes(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = root / "first.png"
            second = root / "second.png"
            Image.new("RGB", (32, 32), "red").save(first)
            second.write_bytes(first.read_bytes())
            data_dir = root / ".pixiv-pbd-manager"
            data_dir.mkdir()
            (data_dir / "gui_settings.json").write_text(
                json.dumps({"download_roots": [str(root)], "exclude_roots": [str(root)]}),
                encoding="utf-8",
            )
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                exit_code, events = invoke(
                    "similar.run",
                    {"roots": [str(root)], "exclude_roots": [], "threshold": "likely"},
                )
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        payload = events[-1]["payload"]
        self.assertEqual(len(payload["groups"]), 1)
        self.assertEqual(payload["groups"][0]["kind"], "exact")

    def test_similar_run_can_skip_pixiv_page_pairs(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            first = root / "12345678_p0.png"
            second = root / "12345678_p1.png"
            Image.new("RGB", (32, 32), "red").save(first)
            second.write_bytes(first.read_bytes())
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                exit_code, events = invoke(
                    "similar.run",
                    {"roots": [str(root)], "threshold": "likely", "similar_skip_pixiv_pages": True},
                )
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        self.assertEqual(events[-1]["payload"]["groups"], [])

    def test_image_thumbnail_outputs_data_url(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            image_path = root / "sample.png"
            Image.new("RGB", (48, 32), "red").save(image_path)
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                exit_code, events = invoke("image.thumbnail", {"path": str(image_path), "max_size": 32})
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        payload = events[-1]["payload"]
        self.assertEqual(payload["width"], 48)
        self.assertEqual(payload["height"], 32)
        self.assertTrue(payload["data_url"].startswith("data:image/"))

    def test_image_difference_outputs_data_url(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            first = root / "first.png"
            second = root / "second.png"
            Image.new("RGB", (48, 32), "red").save(first)
            Image.new("RGB", (48, 32), "blue").save(second)
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                exit_code, events = invoke(
                    "image.difference",
                    {"base_path": str(first), "compare_path": str(second), "max_size": 32},
                )
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        payload = events[-1]["payload"]
        self.assertGreater(payload["width"], 0)
        self.assertGreater(payload["height"], 0)
        self.assertTrue(payload["data_url"].startswith("data:image/"))

    def test_image_difference_aligns_different_sizes_to_base(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            base = root / "base.png"
            compare = root / "compare.png"
            Image.new("RGB", (128, 64), "red").save(base)
            Image.new("RGB", (80, 80), "red").save(compare)
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                exit_code, events = invoke(
                    "image.difference",
                    {"base_path": str(base), "compare_path": str(compare), "max_size": 64},
                )
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        payload = events[-1]["payload"]
        # The diff canvas matches the base image's (thumbnailed) dimensions,
        # not a union of both sizes, because compare is resized onto base.
        self.assertEqual((payload["width"], payload["height"]), (64, 32))
        self.assertTrue(payload["data_url"].startswith("data:image/"))

    @unittest.skipUnless(os.name == "nt", "Windows explorer argument regression")
    def test_file_reveal_uses_shell_execute_explorer_select_argument(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            image_path = root / "sample image.jpg"
            image_path.write_bytes(b"fake")
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                with patch("pixiv_pbd_manager.gui_api.commands.files._windows_shell_execute") as shell_execute:
                    exit_code, events = invoke("file.reveal", {"path": str(image_path)})
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        self.assertEqual(events[-1]["payload"]["opened"], True)
        self.assertEqual(events[-1]["payload"]["selected"], True)
        shell_execute.assert_called_once_with("explorer.exe", f'/select,"{image_path.resolve()}"')

    @unittest.skipUnless(os.name == "nt", "Windows missing-path fallback")
    def test_file_reveal_missing_file_opens_existing_parent_on_windows(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            missing = root / "missing image.jpg"
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                with patch("pixiv_pbd_manager.gui_api.commands.files._windows_shell_execute") as shell_execute:
                    exit_code, events = invoke("file.reveal", {"path": str(missing)})
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        self.assertEqual(events[-1]["payload"]["opened"], True)
        self.assertEqual(events[-1]["payload"]["selected"], False)
        shell_execute.assert_called_once_with(str(root.resolve()))

    def test_emit_event_survives_lone_surrogate_in_payload(self):
        # File / folder paths from Windows occasionally surface lone surrogates
        # (``\udc81``-range chars produced by ``surrogateescape`` decode of
        # mbcs bytes). A user-reported crash was ``'utf-8' codec can't encode
        # character '\\udc81' ...`` originating from the JSON-encode step of
        # ``emit_event``. The IPC line is ASCII-only so both lone surrogates
        # and CJK artist names survive Windows stdout decoding paths.
        from pixiv_pbd_manager.gui_api import runtime
        import io as _io

        buf = _io.BytesIO()

        class _Stub:
            def __init__(self, target):
                self.buffer = target

            def write(self, _):
                raise AssertionError("path should write via .buffer, not .write")

            def flush(self):
                pass

        stub = _Stub(buf)
        with patch.object(runtime, "sys", new=type("S", (), {"stdout": stub})):
            runtime.emit_event({"type": "progress", "path": "test\udc81", "name": "カンザリン"})
        data = buf.getvalue()
        self.assertIn(b"\\udc81", data)
        self.assertIn(b"\\u30ab\\u30f3\\u30b6\\u30ea\\u30f3", data)
        self.assertNotIn("カンザリン".encode("utf-8"), data)

    def test_unknown_command_outputs_error_event(self):
        exit_code, events = invoke("missing.command")

        self.assertEqual(exit_code, 2)
        self.assertEqual(events[-1]["type"], "error")

    def test_main_reads_payload_from_file(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            payload_file = root / "payload.json"
            payload_file.write_text(json.dumps({"settings": {}}), encoding="utf-8")
            buf = io.StringIO()
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                with redirect_stdout(buf):
                    exit_code = gui_api.main(["settings.save", "--payload-file", str(payload_file)])
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        events = [json.loads(line) for line in buf.getvalue().splitlines()]
        self.assertEqual(events[-1]["type"], "result")

    def test_main_reads_payload_from_stdin(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            buf = io.StringIO()
            old_cwd = Path.cwd()
            old_stdin = sys.stdin
            try:
                os.chdir(root)
                sys.stdin = io.StringIO(json.dumps({"settings": {}}))
                with redirect_stdout(buf):
                    exit_code = gui_api.main(["settings.save", "-"])
            finally:
                sys.stdin = old_stdin
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        events = [json.loads(line) for line in buf.getvalue().splitlines()]
        self.assertEqual(events[-1]["type"], "result")

    def test_main_payload_file_strips_utf8_bom(self):
        # PowerShell 5.1's `Out-File -Encoding utf8` writes UTF-8 with a BOM,
        # which json.loads rejects. The payload-file reader must tolerate it.
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            payload_file = root / "payload.json"
            payload_file.write_bytes(b"\xef\xbb\xbf" + json.dumps({"settings": {}}).encode("utf-8"))
            buf = io.StringIO()
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                with redirect_stdout(buf):
                    exit_code = gui_api.main(["settings.save", "--payload-file", str(payload_file)])
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        events = [json.loads(line) for line in buf.getvalue().splitlines()]
        self.assertEqual(events[-1]["type"], "result")

    def test_main_payload_file_missing_path_errors(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            exit_code = gui_api.main(["settings.get", "--payload-file"])

        self.assertEqual(exit_code, 2)
        events = [json.loads(line) for line in buf.getvalue().splitlines()]
        self.assertEqual(events[-1]["type"], "error")
        self.assertIn("--payload-file", events[-1]["message"])

    def test_update_download_and_browser_commands_return_results(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            db_path = root / ".pixiv-pbd-manager" / "artists.json"
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                for command, payload in (
                    ("updates.check", {"db_path": str(db_path), "artist_ids": []}),
                    ("updates.download", {"db_path": str(db_path), "artist_ids": []}),
                    ("browser.open", {"urls": []}),
                ):
                    with self.subTest(command=command):
                        exit_code, events = invoke(command, payload)
                        self.assertEqual(exit_code, 0)
                        self.assertEqual(events[-1]["type"], "result")
            finally:
                os.chdir(old_cwd)

    def test_updates_download_passes_download_concurrency(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            db_path = root / ".pixiv-pbd-manager" / "artists.json"
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                with patch(
                    "pixiv_pbd_manager.gui_api.commands.updates.download_artist_updates",
                    return_value=DownloadUpdatesResult(),
                ) as download:
                    exit_code, events = invoke(
                        "updates.download",
                        {"db_path": str(db_path), "artist_ids": [], "download_concurrency": 4},
                    )
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        self.assertEqual(events[-1]["type"], "result")
        self.assertEqual(download.call_args.kwargs["download_concurrency"], 4)

    def test_cleanup_commands_quarantine_restore_and_ignore(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            library = root / "library"
            quarantine = root / "quarantine"
            library.mkdir()
            source = library / "image.jpg"
            source.write_bytes(b"duplicate")
            stat = source.stat()
            entry = {
                "path": str(source),
                "size_bytes": stat.st_size,
                "mtime_ns": stat.st_mtime_ns,
                "width": 10,
                "height": 10,
                "sha256": "a" * 64,
                "phash": "0" * 16,
                "dhash": "0" * 16,
            }
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                ignore_code, ignore_events = invoke(
                    "cleanup.ignore",
                    {"signature": "signature", "kind": "exact", "entry_count": 2},
                )
                quarantine_code, quarantine_events = invoke(
                    "cleanup.quarantine",
                    {
                        "quarantine_dir": str(quarantine),
                        "scan_roots": [str(library)],
                        "download_roots": [str(library)],
                        "items": [entry],
                    },
                )
                missing_after_quarantine = not source.exists()
                operation_id = quarantine_events[-1]["payload"]["operation_id"]
                restore_code, restore_events = invoke(
                    "cleanup.restore",
                    {"operation_id": operation_id},
                )
                exists_after_restore = source.exists()
                restored_path = str(source.resolve())
                unignore_code, unignore_events = invoke(
                    "cleanup.unignore",
                    {"signature": "signature"},
                )
            finally:
                os.chdir(old_cwd)

        self.assertEqual(ignore_code, 0)
        self.assertEqual(ignore_events[-1]["payload"]["ignored_groups"][0]["signature"], "signature")
        self.assertEqual(quarantine_code, 0)
        self.assertTrue(missing_after_quarantine)
        self.assertEqual(restore_code, 0)
        self.assertTrue(exists_after_restore)
        self.assertEqual(restore_events[-1]["payload"]["restored_paths"], [restored_path])
        self.assertEqual(unignore_code, 0)
        self.assertEqual(unignore_events[-1]["payload"]["ignored_groups"], [])

    def test_cleanup_rejects_quarantine_inside_scan_root(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            library = root / "library"
            library.mkdir()
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                exit_code, events = invoke(
                    "cleanup.quarantine",
                    {
                        "quarantine_dir": str(library / "quarantine"),
                        "scan_roots": [str(library)],
                        "items": [{"path": str(library / "missing.jpg")}],
                    },
                )
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 1)
        self.assertEqual(events[-1]["type"], "error")
        self.assertIn("cannot be inside", events[-1]["message"])

    def test_cleanup_list_and_delete_commands(self):
        with TemporaryDirectory() as tmp:
            root = _isolate(tmp)
            library = root / "library"
            quarantine = root / "quarantine"
            library.mkdir()
            source = library / "image.jpg"
            source.write_bytes(b"duplicate")
            stat = source.stat()
            entry = {
                "path": str(source),
                "size_bytes": stat.st_size,
                "mtime_ns": stat.st_mtime_ns,
                "width": 10,
                "height": 10,
                "sha256": "a" * 64,
                "phash": "0" * 16,
                "dhash": "0" * 16,
            }
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                quarantine_code, quarantine_events = invoke(
                    "cleanup.quarantine",
                    {
                        "quarantine_dir": str(quarantine),
                        "scan_roots": [str(library)],
                        "items": [entry],
                    },
                )
                operation_id = quarantine_events[-1]["payload"]["operation_id"]
                list_code, list_events = invoke("cleanup.list", {})
                delete_code, delete_events = invoke(
                    "cleanup.delete",
                    {"operation_id": operation_id},
                )
            finally:
                os.chdir(old_cwd)

        self.assertEqual(quarantine_code, 0)
        self.assertEqual(list_code, 0)
        self.assertEqual(list_events[-1]["payload"]["operations"][0]["id"], operation_id)
        self.assertEqual(delete_code, 0)
        self.assertEqual(delete_events[-1]["payload"]["deleted"], 1)
        self.assertEqual(
            delete_events[-1]["payload"]["operations"][0]["items"][0]["status"],
            "deleted",
        )


if __name__ == "__main__":
    unittest.main()
