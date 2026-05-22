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


class GuiApiTests(unittest.TestCase):
    def test_settings_get_outputs_result_event(self):
        with TemporaryDirectory() as tmp:
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
            root = Path(tmp)
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
            root = Path(tmp)
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
            root = Path(tmp)
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
            root = Path(tmp)
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                with patch(
                    "pixiv_pbd_manager.gui_api.fetch_user_profile",
                    return_value=PixivUserProfile(id="123456", name="Online Artist"),
                ):
                    exit_code, events = invoke("artists.add", {"artist_id": "123456", "name": ""})
                db = ArtistDatabase.load(root / ".pixiv-pbd-manager" / "artists.json")
            finally:
                os.chdir(old_cwd)

        self.assertEqual(exit_code, 0)
        self.assertEqual(events[-1]["payload"]["name"], "Online Artist")
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
            root = Path(tmp)
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
            root = Path(tmp)
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

    def test_unknown_command_outputs_error_event(self):
        exit_code, events = invoke("missing.command")

        self.assertEqual(exit_code, 2)
        self.assertEqual(events[-1]["type"], "error")

    def test_update_download_and_browser_commands_return_results(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
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
