import hashlib
import os
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image

from pixiv_pbd_manager.gui_api import run_command
from pixiv_pbd_manager.library.sync import discover, stable_files
from pixiv_pbd_manager.resolver import ArtworkTag


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


def link_dir(link, target):
    if os.name == "nt":
        import _winapi
        _winapi.CreateJunction(str(target), str(link))
    else:
        link.symlink_to(target, target_is_directory=True)


SPELLINGS = [lambda root: str(root / ".." / root.name)] + ([lambda root: str(root).swapcase()] if os.name == "nt" else [])


@pytest.mark.parametrize("spell", SPELLINGS)
def test_root_spelling_does_not_change_index_keys(dataset, spell):
    root = Path(dataset["download_roots"][0])
    path = picture(dataset, "a/10000001_p0.png")
    dataset["download_roots"] = [spell(root)]
    assert [row["path"] for row in call(dataset, "library.sync", full=True)["upserts"]] == [str(path)]
    path.unlink()
    changed = str(Path(dataset["download_roots"][0]) / "a" / path.name)
    assert call(dataset, "library.sync", changed_paths=[changed])["removed"] == [str(path)]


def test_linked_root_and_subfolder_are_walked_by_target(dataset):
    real = Path(dataset["download_roots"][0])
    path = picture(dataset, "a/10000001_p0.png")
    link_dir(real / "alias", real / "a")
    root = real.with_name("linked")
    link_dir(root, real)
    dataset["download_roots"] = [str(root)]
    result = call(dataset, "library.sync", full=True)
    assert [row["path"] for row in result["upserts"]] == [str(path)] and not result["unavailable"]
    path.unlink()
    assert call(dataset, "library.sync", changed_paths=[str(root / "a" / path.name)])["removed"] == [str(path)]


def test_partial_deletion_does_not_remove_unscanned_folders(dataset):
    a = picture(dataset, "a/deep/10000001_p0.png")
    b = picture(dataset, "b/10000002_p0.png")
    call(dataset, "library.sync", full=True)
    a.unlink()
    result = call(dataset, "library.sync", changed_paths=[str(a)])
    assert result["removed"] == [str(a)]
    assert [row["path"] for row in call(dataset, "library.list")["images"]] == [str(b)]


@pytest.mark.skipif(os.path.normcase("A") == "A", reason="needs a case-insensitive volume")
@pytest.mark.parametrize("relative", ["a/ART.png", "A/art.png"])
def test_case_only_rename_replaces_the_old_spelling(dataset, relative):
    path = picture(dataset, "a/art.png")
    call(dataset, "library.sync", full=True)
    before = call(dataset, "library.list")["images"][0]
    renamed = Path(dataset["download_roots"][0]) / relative
    moved = (path, renamed) if renamed.parent.name == "a" else (path.parent, renamed.parent)
    moved[0].rename(moved[1])
    assert call(dataset, "library.sync", changed_paths=[str(item) for item in moved])["removed"] == [str(path)]
    images = call(dataset, "library.list")["images"]
    assert [(image["path"], image["image_id"]) for image in images] == [(str(renamed), before["image_id"])]


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
        found, completed, unreadable, unavailable = discover([(path.parent, True)], [Path(dataset["download_roots"][0])], [], lambda: False)
    assert not found and not completed and not unreadable and unavailable


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
    assert not result["upserts"] and not result["pending"] and result["indexed"] == 1



def test_unchanged_audit_neither_rebuilds_files_nor_rewrites_the_index(dataset):
    picture(dataset, "a/10000001_p0.png")
    added = picture(dataset, "b/10000002_p0.png")
    call(dataset, "library.sync", full=True)
    index = Path(dataset["project_root"]) / ".pixiv-pbd-manager" / "library_index.json"
    before = (index.stat().st_mtime_ns, index.read_bytes())
    from pixiv_pbd_manager.gui_api.commands import library_sync
    with patch.object(library_sync, "build_catalog", wraps=library_sync.build_catalog) as build:
        result = call(dataset, "library.sync", full=True)
        assert build.call_args.kwargs["file_paths"] == []
        assert (index.stat().st_mtime_ns, index.read_bytes()) == before
        assert result["index_version"] == result["base_version"] and result["indexed"] == 2
        added.write_bytes(added.read_bytes() + b"\0")
        call(dataset, "library.sync", full=True)
        assert build.call_args.kwargs["file_paths"] == [added]

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


def test_audit_drops_removed_root_and_new_exclude_but_not_unreachable_root(dataset):
    kept = picture(dataset, "keep/10000001_p0.png")
    private = picture(dataset, "private/10000002_p0.png")
    old = Path(dataset["project_root"]) / "old"
    (old / "a").mkdir(parents=True)
    Image.new("RGB", (10, 20)).save(old / "a" / "10000003_p0.png")
    root = dataset["download_roots"][0]
    call(dataset, "library.sync", full=True, download_roots=[root, str(old)])
    typo = call(dataset, "library.sync", full=True, download_roots=[root + "-half-typed"])
    assert typo["unavailable"] and typo["removed"] == []
    result = call(dataset, "library.sync", full=True, exclude_roots=[str(private.parent)])
    assert result["removed"] == sorted([str(private), str(old / "a" / "10000003_p0.png")])
    assert [row["path"] for row in call(dataset, "library.list", exclude_roots=[str(private.parent)])["images"]] == [str(kept)]


def test_unreadable_image_is_skipped_not_retried(dataset):
    good = picture(dataset, "a/10000001_p0.png")
    broken = Path(dataset["download_roots"][0]) / "a" / "10000002_p0.png"
    broken.write_bytes(b"<html>403</html>")
    result = call(dataset, "library.sync", full=True)
    assert result["pending"] == [] and [row["path"] for row in result["upserts"]] == [str(good)]
    assert not call(dataset, "library.status")["stale"]


def test_unreadable_subfolder_does_not_void_the_root(dataset):
    kept = picture(dataset, "open/10000001_p0.png")
    hidden = picture(dataset, "locked/10000002_p0.png")
    call(dataset, "library.sync", full=True)
    kept.unlink()
    real_scandir = os.scandir
    def scandir(path):
        if Path(path).name == "locked":
            raise PermissionError("denied")
        return real_scandir(path)
    with patch("pixiv_pbd_manager.library.sync.os.scandir", scandir):
        result = call(dataset, "library.sync", full=True)
    assert not result["unavailable"] and result["removed"] == [str(kept)]
    assert [row["path"] for row in call(dataset, "library.list")["images"]] == [str(hidden)]


def test_lost_index_still_moves_annotations(dataset):
    path = picture(dataset, "a/10000001_p0.png")
    call(dataset, "library.sync", full=True)
    call(dataset, "library.update_metadata", paths=[str(path)], tags=["keep-me"])
    call(dataset, "library.annotations.protect")
    (Path(dataset["project_root"]) / ".pixiv-pbd-manager" / "library_index.json").unlink()
    moved = path.parent.with_name("b")
    path.parent.rename(moved)
    call(dataset, "library.sync", full=True)
    [row] = call(dataset, "library.list")["images"]
    assert row["path"] == str(moved / path.name) and row["tags"] == ["keep-me"]
    assert call(dataset, "library.annotations.unlinked")["total"] == 0


def test_tag_fetch_rewrites_the_index_under_the_sync_commit_lock(dataset):
    picture(dataset, "a/10000001_p0.png")
    call(dataset, "library.sync", full=True)
    from pixiv_pbd_manager.gui_api.commands import library
    from pixiv_pbd_manager.recovery import locking
    commit = (Path(dataset["project_root"]) / ".pixiv-pbd-manager" / "sync-commit").resolve()
    key = hashlib.sha256(os.path.normcase(str(commit)).encode()).hexdigest()
    held, save = [], library.save_library_index

    def recording(*args, **kwargs):
        held.append(key in getattr(locking._local, "held", {}))
        return save(*args, **kwargs)
    fetched = ([ArtworkTag(tag="sky", translation="")], False)
    with patch.object(library, "save_library_index", recording):
        with patch("pixiv_pbd_manager.resolver.fetch_artwork_tags", return_value=fetched):
            call(dataset, "library.fetch_tags", resolve_delay=0)
    assert held and all(held)
    assert call(dataset, "library.list")["images"][0]["pixiv_tags"] == [{"tag": "sky", "translation": ""}]
