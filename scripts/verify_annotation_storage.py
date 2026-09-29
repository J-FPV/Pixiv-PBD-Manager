"""Exercise SQLite migration, writes and move recovery inside a frozen worker."""

from __future__ import annotations

import base64
import json
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory


def verify_annotation_storage(worker: Path) -> None:
    with TemporaryDirectory(prefix="pbd-annotation-smoke-") as directory:
        root = Path(directory).resolve()
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
        collection = call("collections.create", kind="project", name="Smoke project")["id"]
        store_id = call("collections.list")["store_id"]
        call("collections.members.add", id=collection, store_id=store_id, image_ids=[saved["image_id"]])
        call("library.sync", full=True)
        members = call("collections.list", id=collection)["collections"][0]["members"]
        if len(members) != 1 or not members[0]["available"]:
            raise RuntimeError("Frozen project collection failed")
        snapshot = call("backup.create")["id"]
        call("collections.delete", id=collection)
        preview = call("backup.preview", id=snapshot, categories=["collections"])
        call("backup.restore", id=snapshot, categories=["collections"], token=preview["token"])
        if call("collections.list", id=collection)["collections"][0]["member_count"] != 1:
            raise RuntimeError("Frozen collection restore failed")
        pending = images / "Pending"
        pending.mkdir()
        (images / "renamed.png").rename(pending / "original.png")
        call("scan.preview", roots=[str(images)], resolve_online=False)
        review = call("scan.review.list")["items"]
        detail = call("scan.review.detail", path=review[0]["path"]) if review else None
        if not detail or detail["status"] not in ("no_clues", "pending") or detail["candidates"]:
            raise RuntimeError(f"Frozen review queue failed: {detail}")
        print("OK: frozen SQLite annotation storage, protection and move recovery")
        print("OK: frozen backup creation, category restore and persistent undo")
        print("OK: frozen review queue, directory sync and collection backup v2")


if __name__ == "__main__":
    import sys
    verify_annotation_storage(Path(sys.argv[1]).resolve())
