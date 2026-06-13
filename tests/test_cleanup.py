from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from pixiv_pbd_manager.cleanup import (
    cleanup_summary,
    delete_quarantined_files,
    quarantine_files,
    restore_files,
    validate_quarantine_root,
)
from pixiv_pbd_manager.similar import (
    ImageFingerprint,
    SimilarGroup,
    cleanup_recommendation,
    group_signature,
    load_image_index,
    save_image_index,
)


def fingerprint(path: Path, *, sha256: str, width: int, height: int, size: int, mtime: int) -> ImageFingerprint:
    return ImageFingerprint(
        path=str(path),
        size_bytes=size,
        mtime_ns=mtime,
        width=width,
        height=height,
        sha256=sha256,
        phash="0" * 16,
        dhash="0" * 16,
    )


def payload(entry: ImageFingerprint) -> dict[str, object]:
    return entry.to_json()


class CleanupRecommendationTests(unittest.TestCase):
    def test_exact_group_prefers_resolution_then_size_then_mtime(self):
        entries = [
            fingerprint(Path("small.jpg"), sha256="a", width=100, height=100, size=900, mtime=9),
            fingerprint(Path("large-a.jpg"), sha256="a", width=200, height=200, size=800, mtime=8),
            fingerprint(Path("large-b.png"), sha256="a", width=200, height=200, size=1200, mtime=7),
        ]
        keep, remove, reclaim = cleanup_recommendation(SimilarGroup(1, "exact", entries))
        self.assertEqual(keep, "large-b.png")
        self.assertEqual(set(remove), {"small.jpg", "large-a.jpg"})
        self.assertEqual(reclaim, 1700)

    def test_likely_group_requires_close_aspect_ratios(self):
        close = [
            fingerprint(Path("a.jpg"), sha256="a", width=1000, height=1000, size=1, mtime=1),
            fingerprint(Path("b.jpg"), sha256="b", width=1010, height=1000, size=1, mtime=1),
        ]
        far = [
            close[0],
            fingerprint(Path("wide.jpg"), sha256="c", width=1600, height=900, size=1, mtime=1),
        ]
        self.assertTrue(cleanup_recommendation(SimilarGroup(1, "likely", close))[1])
        self.assertEqual(cleanup_recommendation(SimilarGroup(2, "likely", far)), (None, [], 0))
        self.assertEqual(cleanup_recommendation(SimilarGroup(3, "possible", close)), (None, [], 0))

    def test_signature_changes_when_group_content_changes(self):
        first = fingerprint(Path("a.jpg"), sha256="a", width=10, height=10, size=10, mtime=1)
        second = fingerprint(Path("b.jpg"), sha256="b", width=10, height=10, size=10, mtime=1)
        self.assertNotEqual(group_signature([first]), group_signature([first, second]))
        moved = fingerprint(Path("elsewhere.jpg"), sha256="a", width=10, height=10, size=10, mtime=2)
        self.assertEqual(group_signature([first]), group_signature([moved]))


class CleanupFileTests(unittest.TestCase):
    def test_quarantine_restore_and_delete_round_trip(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            library = root / "图库"
            quarantine = root / "隔离"
            library.mkdir()
            first = library / "同名.jpg"
            second_dir = library / "nested"
            second_dir.mkdir()
            second = second_dir / "同名.jpg"
            first.write_bytes(b"first")
            second.write_bytes(b"second")
            first_stat = first.stat()
            second_stat = second.stat()
            entries = [
                fingerprint(
                    first,
                    sha256="a" * 64,
                    width=10,
                    height=10,
                    size=first_stat.st_size,
                    mtime=first_stat.st_mtime_ns,
                ),
                fingerprint(
                    second,
                    sha256="b" * 64,
                    width=20,
                    height=20,
                    size=second_stat.st_size,
                    mtime=second_stat.st_mtime_ns,
                ),
            ]
            state_path = root / "cleanup_state.json"
            index_path = root / "image_index.json"
            save_image_index(entries, index_path)
            result = quarantine_files(
                [payload(entry) for entry in entries],
                quarantine_root=quarantine,
                protected_roots=[library],
                state_path=state_path,
                index_path=index_path,
            )

            self.assertFalse(first.exists())
            self.assertFalse(second.exists())
            self.assertEqual(len(result["moved_paths"]), 2)
            self.assertEqual(load_image_index(index_path), {})
            operation = result["operations"][0]
            manifest = Path(operation["manifest_path"])
            self.assertTrue(manifest.is_file())
            self.assertEqual(json.loads(manifest.read_text(encoding="utf-8"))["version"], 1)

            first_item = operation["items"][0]
            restored = restore_files(
                operation["id"],
                item_ids=[first_item["id"]],
                state_path=state_path,
                index_path=index_path,
            )
            self.assertTrue(first.exists())
            self.assertEqual(restored["restored_paths"], [str(first.resolve())])
            self.assertIn(str(first.resolve()), load_image_index(index_path))

            remaining = next(
                item
                for item in restored["operations"][0]["items"]
                if item["status"] == "quarantined"
            )
            deleted = delete_quarantined_files(
                operation["id"],
                item_ids=[remaining["id"]],
                state_path=state_path,
            )
            self.assertEqual(deleted["deleted"], 1)
            self.assertFalse(Path(remaining["quarantine_path"]).exists())

    def test_restore_never_overwrites_existing_target(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            library = root / "library"
            quarantine = root / "quarantine"
            library.mkdir()
            source = library / "image.jpg"
            source.write_bytes(b"original")
            stat = source.stat()
            entry = fingerprint(
                source,
                sha256="a" * 64,
                width=10,
                height=10,
                size=stat.st_size,
                mtime=stat.st_mtime_ns,
            )
            state_path = root / "state.json"
            index_path = root / "index.json"
            moved = quarantine_files(
                [payload(entry)],
                quarantine_root=quarantine,
                protected_roots=[library],
                state_path=state_path,
                index_path=index_path,
            )
            source.write_bytes(b"replacement")
            restored = restore_files(
                moved["operation_id"],
                state_path=state_path,
                index_path=index_path,
            )
            self.assertEqual(source.read_bytes(), b"replacement")
            item = restored["operations"][0]["items"][0]
            self.assertEqual(item["status"], "quarantined")
            self.assertIn("already exists", item["error"])

    def test_quarantine_cannot_be_inside_library(self):
        with TemporaryDirectory() as tmp:
            library = Path(tmp) / "library"
            library.mkdir()
            with self.assertRaises(ValueError):
                validate_quarantine_root(library / "quarantine", [library])

    def test_cross_device_cleanup_checks_available_space_before_moving(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            library = root / "library"
            quarantine = root / "quarantine"
            library.mkdir()
            source = library / "image.jpg"
            source.write_bytes(b"image")
            stat = source.stat()
            entry = fingerprint(
                source,
                sha256="a" * 64,
                width=10,
                height=10,
                size=stat.st_size,
                mtime=stat.st_mtime_ns,
            )
            with (
                patch("pixiv_pbd_manager.cleanup._copy_bytes_required", return_value=100),
                patch(
                    "pixiv_pbd_manager.cleanup.shutil.disk_usage",
                    return_value=SimpleNamespace(free=50),
                ),
            ):
                with self.assertRaisesRegex(OSError, "Not enough free space"):
                    quarantine_files(
                        [payload(entry)],
                        quarantine_root=quarantine,
                        protected_roots=[library],
                        state_path=root / "state.json",
                        index_path=root / "index.json",
                    )
            self.assertTrue(source.exists())
            self.assertFalse((root / "state.json").exists())

    def test_graceful_cancel_stops_between_files_and_keeps_history(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            library = root / "library"
            quarantine = root / "quarantine"
            library.mkdir()
            entries = []
            for index in range(2):
                source = library / f"{index}.jpg"
                source.write_bytes(bytes([index]))
                stat = source.stat()
                entries.append(
                    fingerprint(
                        source,
                        sha256=str(index) * 64,
                        width=10,
                        height=10,
                        size=stat.st_size,
                        mtime=stat.st_mtime_ns,
                    )
                )
            checks = 0

            def should_cancel():
                nonlocal checks
                checks += 1
                return checks > 1

            result = quarantine_files(
                [payload(entry) for entry in entries],
                quarantine_root=quarantine,
                protected_roots=[library],
                state_path=root / "state.json",
                index_path=root / "index.json",
                should_cancel=should_cancel,
            )

            self.assertTrue(result["cancelled"])
            self.assertFalse(Path(entries[0].path).exists())
            self.assertTrue(Path(entries[1].path).exists())
            statuses = [item["status"] for item in result["operations"][0]["items"]]
            self.assertEqual(statuses, ["quarantined", "cancelled"])

    def test_summary_reconciles_interrupted_move(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            task = root / "task"
            task.mkdir()
            quarantined = task / "image.jpg"
            quarantined.write_bytes(b"x")
            manifest = task / "manifest.json"
            state_path = root / "state.json"
            operation = {
                "id": "op",
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
                "quarantine_root": str(root),
                "manifest_path": str(manifest),
                "status": "partial",
                "items": [
                    {
                        "id": "item",
                        "original_path": str(root / "missing.jpg"),
                        "quarantine_path": str(quarantined),
                        "sha256": "a" * 64,
                        "size_bytes": 1,
                        "mtime_ns": 1,
                        "width": 1,
                        "height": 1,
                        "phash": "0" * 16,
                        "dhash": "0" * 16,
                        "status": "moving",
                    }
                ],
            }
            state_path.write_text(
                json.dumps({"version": 1, "ignored_groups": {}, "operations": [operation]}),
                encoding="utf-8",
            )
            summary = cleanup_summary(state_path)
            self.assertEqual(summary["operations"][0]["items"][0]["status"], "quarantined")


if __name__ == "__main__":
    unittest.main()
