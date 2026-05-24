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
        # ``emit_event``. ``backslashreplace`` on the final encode now turns
        # the offending char into a printable escape instead of aborting.
        from pixiv_pbd_manager.gui_api import runtime
        import io as _io
        import contextlib

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
            runtime.emit_event({"type": "progress", "path": "test\udc81"})
        self.assertIn(b"\\udc81", buf.getvalue())

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


if __name__ == "__main__":
    unittest.main()
