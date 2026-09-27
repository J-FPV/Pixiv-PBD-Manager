"""Exercise SQLite migration, writes and move recovery inside a frozen worker."""

from __future__ import annotations

import base64
import json
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory


def verify_annotation_storage(worker: Path) -> None:
    with TemporaryDirectory(prefix="pbd-annotation-smoke-") as directory:
        root = Path(directory)
        (root / ".pixiv-pbd-manager").mkdir()
        images = root / "images"
        images.mkdir()
        original = images / "original.png"
        original.write_bytes(base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYp8AAAAASUVORK5CYII="))

        def call(command: str, **values):
            payload = {"project_root": str(root), "download_roots": [str(images)], **values}
            result = subprocess.run([str(worker), command, "-"], input=json.dumps(payload).encode() + b"\n",
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=root, timeout=30,
                                    creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0)
            if result.returncode:
                raise RuntimeError(result.stdout.decode("utf-8", errors="replace") + result.stderr.decode("utf-8", errors="replace"))
            events = [json.loads(line) for line in result.stdout.decode("utf-8").splitlines()]
            return next(event["payload"] for event in events if event.get("type") == "result")

        call("library.scan")
        saved = call("library.update_metadata", paths=[str(original)], rating=5, add_tags=["smoke"])["images"][0]
        call("library.annotations.protect")
        original.rename(images / "renamed.png")
        call("library.scan")
        restored = call("library.list")["images"][0]
        if (restored["image_id"], restored["rating"], restored["tags"]) != (saved["image_id"], 5, ["smoke"]):
            raise RuntimeError("Frozen SQLite annotation round-trip failed")
        backup = call("backup.create")["id"]
        call("library.update_metadata", paths=[restored["path"]], rating=2)
        call("history.undo", id=call("history.list")["latest_id"])
        if call("library.list")["images"][0]["rating"] != 5:
            raise RuntimeError("Frozen annotation undo failed")
        call("library.update_metadata", paths=[restored["path"]], rating=1)
        preview = call("backup.preview", id=backup, categories=["annotations"])
        call("backup.restore", id=backup, categories=["annotations"], token=preview["token"])
        if call("library.list")["images"][0]["rating"] != 5:
            raise RuntimeError("Frozen backup restore failed")
        print("OK: frozen SQLite annotation storage, protection and move recovery")
        print("OK: frozen backup creation, category restore and persistent undo")


if __name__ == "__main__":
    import sys
    verify_annotation_storage(Path(sys.argv[1]).resolve())
