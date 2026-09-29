from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image

from pixiv_pbd_manager.gui_api import run_command
from pixiv_pbd_manager.library.sync import discover, stable_files


@pytest.fixture
def dataset(tmp_path):
    (tmp_path / ".pixiv-pbd-manager").mkdir()
    root = tmp_path / "library"
    root.mkdir()
    return {"project_root": str(tmp_path), "database": str(tmp_path / "artists.json"), "download_roots": [str(root)]}


def call(data, command, **payload):
    events = []
    assert run_command(command, {**data, **payload}, emit=events.append) == 0, events
    return events[-1]["payload"]


def picture(data, relative, color="red"):
    path = Path(data["download_roots"][0]) / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (10, 20), color).save(path)
    return path


def test_partial_deletion_does_not_remove_unscanned_folders(dataset):
    a = picture(dataset, "a/deep/10000001_p0.png")
    b = picture(dataset, "b/10000002_p0.png")
    call(dataset, "library.sync", full=True)
    a.unlink()
    result = call(dataset, "library.sync", changed_paths=[str(a)])
    assert result["removed"] == [str(a)]
    assert [row["path"] for row in call(dataset, "library.list")["images"]] == [str(b)]


def test_move_keeps_identity_and_annotations(dataset):
    path = picture(dataset, "a/10000001_p0.png")
    call(dataset, "library.sync", full=True)
    before = call(dataset, "library.list")["images"][0]
    call(dataset, "library.update_metadata", paths=[str(path)], rating=5, tags=["saved"])
    call(dataset, "library.annotations.protect")
    moved = path.parent.with_name("b")
    path.parent.rename(moved)
    result = call(dataset, "library.sync", changed_paths=[str(path.parent), str(moved)])
    assert result["removed"] == [str(path)]
    after = call(dataset, "library.list")["images"][0]
    assert after["image_id"] == before["image_id"]
    assert after["rating"] == 5 and after["tags"] == ["saved"]


def test_offline_root_keeps_index_and_identity(dataset):
    picture(dataset, "a/10000001_p0.png")
    call(dataset, "library.sync", full=True)
    before = call(dataset, "library.list")["images"]
    root = Path(dataset["download_roots"][0])
    root.rename(root.with_name("offline"))
    result = call(dataset, "library.sync", full=True)
    assert result["unavailable"] and not result["removed"]
    assert call(dataset, "library.list")["images"] == before


def test_incomplete_enumeration_proves_no_deletion(dataset):
    path = picture(dataset, "a/image.png")
    call(dataset, "library.sync", full=True)
    with patch("pixiv_pbd_manager.library.sync.os.scandir", side_effect=PermissionError("denied")):
        found, completed, unavailable = discover([(path.parent, True)], [Path(dataset["download_roots"][0])], [], lambda: False)
    assert not found and not completed and unavailable


def test_writing_file_defers_and_unchanged_dimensions_reused(dataset):
    path = picture(dataset, "a/image.png")
    stat = path.stat()
    found = {str(path): (stat.st_size, stat.st_mtime_ns)}
    stable, pending = stable_files(found, {}, wait=lambda _seconds: path.write_bytes(b"writing"))
    assert not stable and pending == [str(path)]
    picture(dataset, "a/image.png")
    call(dataset, "library.sync", full=True)
    with patch("pixiv_pbd_manager.library.catalog.read_image_size", side_effect=AssertionError("decoded unchanged file")):
        result = call(dataset, "library.sync", full=True)
    assert result["reused"] == 1 and not result["pending"]


def test_root_disappearing_before_commit_never_proves_deletion(dataset):
    path = picture(dataset, "a/image.png")
    call(dataset, "library.sync", full=True)
    path.unlink()
    from pixiv_pbd_manager.gui_api.commands import library_sync
    original = library_sync.build_catalog
    def offline(*args, **kwargs):
        result = original(*args, **kwargs)
        root = Path(dataset["download_roots"][0])
        root.rename(root.with_name("offline"))
        return result
    with patch.object(library_sync, "build_catalog", offline):
        result = call(dataset, "library.sync", full=True)
    assert result["unavailable"] and result["removed"] == []
    assert call(dataset, "library.list")["images"][0]["path"] == str(path)


def test_historical_quarantine_is_excluded_when_root_expands(dataset):
    import json
    path = picture(dataset, "a/image.png")
    call(dataset, "library.sync", full=True)
    image = call(dataset, "library.list")["images"][0]
    base = Path(dataset["project_root"])
    call(dataset, "cleanup.quarantine", items=[image], quarantine_dir=str(base / "old-quarantine"))
    result = call(dataset, "library.sync", full=True, download_roots=[str(base)])
    assert not result["upserts"] and result["indexed"] == 0
    assert not path.exists()
    ledger = base / ".pixiv-pbd-manager/cleanup_state.json"
    assert json.loads(ledger.read_text())["operations"]
    ledger.write_text("{damaged", encoding="utf-8")
    events = []
    assert run_command("library.sync", {**dataset, "full": True}, emit=events.append) == 1
