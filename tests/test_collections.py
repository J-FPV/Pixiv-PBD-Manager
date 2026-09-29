import json
import os
from pathlib import Path
import sqlite3
from zipfile import ZipFile

from PIL import Image
import pytest

from pixiv_pbd_manager import gui_api
from pixiv_pbd_manager.library.annotation_store import AnnotationStore
from pixiv_pbd_manager.library.collections import CollectionStore
from pixiv_pbd_manager.recovery.session import RecoverySession


@pytest.fixture
def library(tmp_path):
    (tmp_path / ".pixiv-pbd-manager").mkdir()
    images = tmp_path / "images"
    images.mkdir()
    for name, color in (("one", "red"), ("two", "blue")):
        Image.new("RGB", (10, 20), color).save(images / f"{name}.png")
    def call(command, error=False, **payload):
        events, cwd = [], Path.cwd()
        try:
            code = gui_api.run_command(command, {"project_root": str(tmp_path), "download_roots": [str(images)], **payload}, emit=events.append)
        finally:
            os.chdir(cwd)
        if error:
            assert code == 1, events
            return events[-1]["message"]
        assert code == 0, events
        return events[-1]["payload"]
    call("library.scan")
    return tmp_path, images, call


def project(call, name="References"):
    identity = call("collections.create", name=name, kind="project")["id"]
    data = call("collections.list", id=identity)
    ids = [image["image_id"] for image in call("library.list")["images"]]
    call("collections.members.add", id=identity, store_id=data["store_id"], image_ids=ids)
    return identity


def selected(call, identity):
    return next(row for row in call("collections.list", id=identity)["collections"] if row["id"] == identity)


def test_members_follow_move_deduplicate_and_keep_missing(library):
    _, images, call = library
    identity = project(call)
    second = project(call, "Second")
    before = selected(call, identity)
    store_id = call("collections.list")["store_id"]
    assert call("collections.members.add", id=identity, store_id=store_id, image_ids=[m["image_id"] for m in before["members"]])["added"] == 0
    (images / "one.png").rename(images / "renamed.png")
    call("library.sync", full=True)
    after = selected(call, identity)
    assert {m["image_id"] for m in after["members"]} == {m["image_id"] for m in before["members"]}
    assert any(m["path"].endswith("renamed.png") and m["available"] for m in after["members"])
    (images / "two.png").unlink()
    call("library.sync", full=True)
    assert selected(call, second)["member_count"] == 2
    assert sum(m["available"] for m in selected(call, identity)["members"]) == 1
    call("collections.delete", id=identity)
    assert (images / "renamed.png").is_file()
    call("history.undo", id=call("history.list")["latest_id"])
    assert selected(call, identity)["member_count"] == 2


def test_smart_rules_explicit_update_and_conflict_undo(library):
    root, _, call = library
    rules = {"not_used": True, "added_within_days": 30, "ratings": ["4", "5"]}
    identity = call("collections.create", kind="smart", name="Smart", filters=rules, sort={"key": "rating", "direction": "desc"})["id"]
    before = selected(call, identity)
    call("collections.update", id=identity, revision=before["revision"], name="New")
    assert selected(call, identity)["filters"] == rules
    assert "changed" in call("collections.update", id=identity, revision=before["revision"], name="Stale", error=True)
    call("history.undo", id=call("history.list")["latest_id"])
    assert selected(call, identity)["name"] == "Smart"
    call("collections.update", id=identity, name="Again")
    history = call("history.list")["latest_id"]
    with CollectionStore(root / ".pixiv-pbd-manager/library_index.collections.sqlite3") as store:
        body = store.get(identity)
        body["name"] = "External"
        with store.connection:
            store.connection.execute("UPDATE collections SET body=? WHERE id=?", (json.dumps(body), identity))
    assert "conflict" in call("history.undo", id=history, error=True).lower()
    assert selected(call, identity)["name"] == "External"
    call("history.discard", id=history)


def test_backup_v2_collection_restore_does_not_restore_files(library):
    root, images, call = library
    identity = project(call)
    backup = call("backup.create")["id"]
    source = root / ".pixiv-pbd-manager/backups" / f"{backup}.zip"
    with ZipFile(source) as archive:
        assert json.loads(archive.read("manifest.json"))["version"] == 2
        assert "collections.sqlite3" in archive.namelist()
    image = call("library.list")["images"][0]
    call("cleanup.quarantine", items=[image], quarantine_dir=str(root / "quarantine"))
    call("collections.delete", id=identity)
    preview = call("backup.preview", id=backup, categories=["collections"])
    call("backup.restore", id=backup, categories=["collections"], token=preview["token"])
    result = selected(call, identity)
    assert result["member_count"] == 2
    assert any(m["status"] == "quarantined" for m in result["members"])
    assert not Path(image["path"]).exists() and len(list(images.iterdir())) == 1


@pytest.mark.parametrize("duplicate", [False, True])
def test_foreign_members_need_unique_verified_content(library, duplicate):
    root, images, call = library
    identity = project(call)
    saved = selected(call, identity)
    other = root / "other.json"
    from pixiv_pbd_manager.library.catalog import LibraryImage
    from pixiv_pbd_manager.recovery.collection_restore import collection_changes
    with RecoverySession({"_base_dir": str(root), "library_index": str(other)}, "backup.preview", lambda _: None) as session:
        with AnnotationStore(other) as store:
            path = images / "one.png"
            choices = [path]
            if duplicate:
                copy = images / "copy.png"
                copy.write_bytes(path.read_bytes())
                choices.append(copy)
            for path in choices:
                store.insert(LibraryImage(path=str(path), size_bytes=path.stat().st_size, mtime_ns=path.stat().st_mtime_ns, width=10, height=20, format="png"))
        from pixiv_pbd_manager.library.collections import read_backup
        collections = read_backup(root / ".pixiv-pbd-manager/library_index.collections.sqlite3")
        records = collection_changes(session, collections)
        members = records[0]["after"]["members"]
        one_id = next(m["image_id"] for m in saved["members"] if m["path"].endswith("one.png"))
        assert sum(not m["pending"] for m in members) == (0 if duplicate else 1)
        assert all(m["image_id"] != one_id for m in members if not m["pending"])


def test_v1_packages_still_import_and_collection_triggers_rejected(library):
    root, _, call = library
    project(call)
    backup = call("backup.create")["id"]
    with ZipFile(root / ".pixiv-pbd-manager/backups" / f"{backup}.zip") as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    manifest = json.loads(files["manifest.json"])
    manifest["version"] = 1
    manifest["files"].pop("collections.sqlite3")
    legacy = root / "legacy.zip"
    with ZipFile(legacy, "w") as archive:
        for name, value in files.items():
            if name != "collections.sqlite3":
                archive.writestr(name, json.dumps(manifest).encode() if name == "manifest.json" else value)
    assert call("backup.import", path=str(legacy))["id"]
    database = root / "malicious.sqlite3"
    database.write_bytes(files["collections.sqlite3"])
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TRIGGER unsafe AFTER UPDATE ON collections BEGIN DELETE FROM collections; END")
    from pixiv_pbd_manager.library.collections import read_backup
    with pytest.raises(ValueError, match="schema"):
        read_backup(database)


def test_first_seen_survives_moves_legacy_remains_unknown(library):
    root, images, call = library
    before = call("library.list")["images"]
    assert all(row["first_seen_ns"] for row in before)
    (images / "one.png").rename(images / "renamed.png")
    call("library.sync", full=True)
    assert {r["image_id"]: r["first_seen_ns"] for r in call("library.list")["images"]} == {r["image_id"]: r["first_seen_ns"] for r in before}
    from pixiv_pbd_manager.library.catalog import LibraryImage
    with AnnotationStore(root / "legacy.json") as store:
        row = store.insert(LibraryImage(path=str(images / "renamed.png"), size_bytes=1, mtime_ns=1, width=1, height=1, format="png"))
        assert store.get(row)["first_seen_ns"] is None


def test_project_verified_copy_delete_keeps_identity(library):
    _, images, call = library
    identity = project(call)
    before = selected(call, identity)
    original = images / "one.png"
    moved = images / "copied.png"
    moved.write_bytes(original.read_bytes())
    original.unlink()
    call("library.sync", full=True)
    after = selected(call, identity)
    assert {member["image_id"] for member in before["members"]} == {member["image_id"] for member in after["members"]}
    assert all(member["available"] for member in after["members"])


def test_smart_availability_excludes_offline_and_quarantine(library):
    root, images, call = library
    identity = call("collections.create", kind="smart", name="All")["id"]
    rows = call("library.list")["images"]
    call("cleanup.quarantine", items=[rows[0]], quarantine_dir=str(root / "quarantine"))
    images.rename(root / "offline")
    result = call("collections.list", id=identity, image_ids=[row["image_id"] for row in rows])
    members = result["collections"][0]["members"]
    assert {member["status"] for member in members} == {"quarantined", "unavailable"}
    assert not any(member["available"] for member in members)
