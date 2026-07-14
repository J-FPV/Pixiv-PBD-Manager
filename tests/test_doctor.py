from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from pixiv_pbd_manager.database import ArtistDatabase
from pixiv_pbd_manager.doctor import run_library_doctor


class LibraryDoctorTests(unittest.TestCase):
    def test_reports_missing_paths_overlap_and_unsafe_directories(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            library = root / "library"
            library.mkdir()
            nested = library / "artist"
            nested.mkdir()
            missing = library / "missing"
            db_path = root / "artists.json"
            db = ArtistDatabase(db_path)
            db.upsert("1", name="One", source="test", save_path=library)
            db.upsert("2", name="Two", source="test", save_path=nested)
            db.upsert("3", name="Three", source="test", save_path=missing)
            db.save()

            report = run_library_doctor(
                database_path=db_path,
                download_roots=[library],
                user_data_dir=str(library / "browser-profile"),
                quarantine_dir=str(library / "quarantine"),
                index_status={"index_exists": False, "stale": True, "metadata_path": "meta"},
            )

        checks = {check["id"]: check for check in report["checks"]}
        self.assertEqual(checks["database"]["status"], "ok")
        self.assertEqual(checks["save_paths"]["code"], "save_paths_missing")
        self.assertEqual(checks["path_overlap"]["code"], "path_overlap_found")
        self.assertEqual(checks["browser_data"]["status"], "error")
        self.assertEqual(checks["quarantine"]["status"], "error")
        self.assertEqual(checks["library_index"]["code"], "index_missing")

    def test_reports_corrupt_database(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            db_path = root / "artists.json"
            db_path.write_text("{broken", encoding="utf-8")
            report = run_library_doctor(
                database_path=db_path,
                download_roots=[],
                index_status={"index_exists": True, "stale": False, "metadata_path": "meta"},
            )

        checks = {check["id"]: check for check in report["checks"]}
        self.assertEqual(checks["database"]["code"], "database_invalid")
        self.assertEqual(report["summary"]["errors"], 1)

    def test_non_utf8_database_does_not_break_diagnostics(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            db_path = root / "artists.json"
            db_path.write_bytes(b'\x80\x81not-utf8')
            report = run_library_doctor(
                database_path=db_path,
                download_roots=[],
                index_status={"index_exists": True, "stale": False, "metadata_path": "meta"},
            )

        checks = {check["id"]: check for check in report["checks"]}
        self.assertEqual(checks["database"]["code"], "database_invalid")
        self.assertEqual(report["summary"]["errors"], 1)


if __name__ == "__main__":
    unittest.main()
