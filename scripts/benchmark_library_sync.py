"""Isolated 30k-image metadata/collection benchmark; never uses the user's library."""

import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import time
from unittest.mock import patch

from PIL import Image

from pixiv_pbd_manager import gui_api


def main():
    original_cwd = Path.cwd()
    with TemporaryDirectory(prefix="pbd-sync-30000-") as directory:
        root = Path(directory)
        (root / ".pixiv-pbd-manager").mkdir()
        images = root / "images"
        images.mkdir()
        for group in range(100):
            folder = images / str(group)
            folder.mkdir()
            seed = folder / "0.png"
            Image.new("RGB", (8, 12), (group, 80, 120)).save(seed)
            for number in range(1, 300):
                os.link(seed, folder / f"{number}.png")

        def call(command, **payload):
            events = []
            try:
                code = gui_api.run_command(command, {"project_root": str(root), "download_roots": [str(images)], **payload}, emit=events.append)
            finally:
                os.chdir(original_cwd)
            assert code == 0, events[-1]
            return events[-1]["payload"]

        started = time.monotonic()
        initial = call("library.sync", full=True)
        initial_seconds = time.monotonic() - started
        assert initial["indexed"] == 30000 and len(initial["upserts"]) == 30000
        started = time.monotonic()
        with patch("pixiv_pbd_manager.library.catalog.read_image_size", side_effect=AssertionError("Unchanged image decoded")):
            audit = call("library.sync", full=True)
        audit_seconds = time.monotonic() - started
        assert audit["reused"] == 30000 and not audit["upserts"] and not audit["removed"]
        new_file = images / "0" / "new.png"
        Image.new("RGB", (12, 8), "green").save(new_file)
        started = time.monotonic()
        delta = call("library.sync", changed_paths=[str(new_file)])
        delta_seconds = time.monotonic() - started
        assert delta["indexed"] == 30001 and delta["files_seen"] == 301 and len(delta["upserts"]) == 1
        assert not delta["removed"]
        project = call("collections.create", kind="project", name="30k references")["id"]
        data = call("collections.list")
        ids = [row["image_id"] for row in initial["upserts"]]
        started = time.monotonic()
        call("collections.members.add", id=project, store_id=data["store_id"], image_ids=ids)
        collection_seconds = time.monotonic() - started
        assert call("collections.list", id=project)["collections"][0]["member_count"] == 30000
        call("backup.create")
        call("history.undo", id=call("history.list")["latest_id"])
        assert call("collections.list", id=project)["collections"][0]["member_count"] == 0
        print(json.dumps({"images": 30000, "initial_seconds": initial_seconds, "metadata_audit_seconds": audit_seconds,
                          "scoped_sync_seconds": delta_seconds, "project_add_seconds": collection_seconds}, indent=2))


if __name__ == "__main__":
    main()
