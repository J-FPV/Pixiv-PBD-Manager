import json
import os
from pathlib import Path
import sqlite3
from zipfile import ZipFile

from PIL import Image
import pytest

from pixiv_pbd_manager import gui_api
from pixiv_pbd_manager.library.annotation_store import AnnotationStore
from pixiv_pbd_manager.recovery.archive import inspect_archive
from pixiv_pbd_manager.recovery.session import RecoverySession


@pytest.fixture
def library(tmp_path):
    (tmp_path / ".pixiv-pbd-manager").mkdir()
    images = tmp_path / "images"
    images.mkdir()
    for name in ("one", "two"):
        Image.new("RGB", (10, 20), "red").save(images / f"{name}.png")
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


def test_backup_excludes_credentials_and_supports_categories(library):
    root, images, call = library
    call("settings.save", settings={"theme": "dark", "cookie": "secret", "token": "private"},
         ui_preferences={"librarySort": {"key": "rating", "direction": "desc"}, "filter": "private search"})
    call("library.update_metadata", paths=[str(images / "one.png")], rating=4)
    identity = call("backup.create")["id"]
    path = root / ".pixiv-pbd-manager/backups" / f"{identity}.zip"
    manifest, data = inspect_archive(path)
    assert set(data) == {"artists", "settings", "annotations"}
    assert "cookie" not in data["settings"] and "token" not in data["settings"]
    assert "filter" not in data["settings"]["ui_preferences"]
    assert "images" not in manifest["files"]
    call("settings.save", settings={"theme": "light"})
    call("library.update_metadata", paths=[str(images / "one.png")], rating=1)
    preview = call("backup.preview", id=identity, categories=["annotations"])
    call("backup.restore", id=identity, categories=["annotations"], token=preview["token"])
    assert call("library.list")["images"][0]["rating"] in (0, 4)
    assert next(image for image in call("library.list")["images"] if image["path"].endswith("one.png"))["rating"] == 4
    assert call("settings.get")["settings"]["theme"] == "light"


def test_undo_is_persistent_lifo_and_preserves_unrelated_fields(library):
    root, images, call = library
    path = str(images / "one.png")
    call("library.update_metadata", paths=[path], rating=4)
    call("library.update_metadata", paths=[path], add_tags=["saved"])
    history = call("history.list")
    assert len(history["entries"]) == 2
    call("history.undo", id=history["latest_id"])
    image = next(item for item in call("library.list")["images"] if item["path"] == path)
    assert image["rating"] == 4 and image["tags"] == []
    with AnnotationStore(root / ".pixiv-pbd-manager/library_index.json") as store:
        row = store.at_path(path)
        body = {**row["body"], "favorite": True}
        store.connection.execute("UPDATE images SET body=? WHERE id=?", (json.dumps(body), row["id"]))
    call("history.undo", id=call("history.list")["latest_id"])
    image = next(item for item in call("library.list")["images"] if item["path"] == path)
    assert image["rating"] == 0 and image["favorite"] is True


def test_batch_conflict_changes_nothing_and_can_discard(library):
    root, images, call = library
    paths = [str(path) for path in images.iterdir()]
    call("library.update_metadata", paths=paths, rating=3)
    history = call("history.list")
    with AnnotationStore(root / ".pixiv-pbd-manager/library_index.json") as store:
        row = store.at_path(paths[1])
        store.connection.execute("UPDATE images SET body=? WHERE id=?", (json.dumps({**row["body"], "rating": 5}), row["id"]))
    assert "conflict" in call("history.undo", id=history["latest_id"], error=True)
    assert sorted(image["rating"] for image in call("library.list")["images"]) == [3, 5]
    call("history.discard", id=history["latest_id"])
    assert call("history.list")["latest_id"] is None


def test_noop_does_not_add_history_and_only_twenty_remain(library):
    _, images, call = library
    for value in range(24):
        call("library.update_metadata", paths=[str(images / "one.png")], rating=value % 5)
    before = call("history.list")
    call("library.update_metadata", paths=[str(images / "one.png")], rating=3)
    after = call("history.list")
    assert before == after
    assert sum(entry["state"] == "committed" for entry in after["entries"]) == 20


def test_restore_preserves_moved_and_quarantined_bindings(library):
    root, images, call = library
    path = images / "one.png"
    saved = call("library.update_metadata", paths=[str(path)], rating=5)["images"][0]
    call("library.annotations.protect")
    identity = call("backup.create")["id"]
    moved = images / "renamed.png"
    path.rename(moved)
    call("library.scan")
    current = next(row for row in call("library.list")["images"] if row["image_id"] == saved["image_id"])
    call("cleanup.quarantine", items=[current], quarantine_dir=str(root / "quarantine"))
    preview = call("backup.preview", id=identity, categories=["annotations"])
    call("backup.restore", id=identity, categories=["annotations"], token=preview["token"])
    with AnnotationStore(root / ".pixiv-pbd-manager/library_index.json") as store:
        row = store.get(saved["image_id"])
        assert row["status"] == "quarantined" and row["body"]["rating"] == 5
    assert not path.exists() and not moved.exists()


def test_artist_assignment_and_merge_undo(library, monkeypatch):
    _, images, call = library
    monkeypatch.setattr("pixiv_pbd_manager.gui_api.commands.artists._resolve_artist_name_if_missing", lambda *args: "Name")
    call("artists.assign_folder", artist_id="123", folder=str(images))
    call("history.undo", id=call("history.list")["latest_id"])
    assert call("artists.list")["artists"] == []
    call("artists.add", artist_id="123", name="A")
    call("artists.add", artist_id="456", name="B")
    from pixiv_pbd_manager import resolver
    monkeypatch.setattr(resolver, "fetch_user_profile", lambda *args, **kwargs: resolver.PixivUserProfile(id="456", name="B"))
    call("artists.rename", old_id="123", new_id="456")
    call("history.undo", id=call("history.list")["latest_id"])
    assert {item["id"] for item in call("artists.list")["artists"]} == {"123", "456"}


def test_export_import_and_reject_unsafe_packages(library):
    root, _, call = library
    identity = call("backup.create")["id"]
    output = root / "export.zip"
    call("backup.export", id=identity, path=str(output))
    imported = call("backup.import", path=str(output))["id"]
    assert imported != identity
    with ZipFile(root / "bad.zip", "w") as archive:
        archive.writestr("../artists.json", "{}")
        archive.writestr("manifest.json", "{}")
    assert "Unsafe" in call("backup.import", path=str(root / "bad.zip"), error=True)


def test_restore_rejects_stale_preview_and_corrupt_db_can_be_recovered(library):
    root, _, call = library
    call("artists.add", artist_id="123", name="A")
    identity = call("backup.create")["id"]
    preview = call("backup.preview", id=identity, categories=["artists"])
    call("artists.add", artist_id="456", name="B")
    assert "changed" in call("backup.restore", id=identity, categories=["artists"], token=preview["token"], error=True)
    db = root / ".pixiv-pbd-manager/artists.json"
    db.write_text("{broken", encoding="utf-8")
    assert "damaged" in call("artists.add", artist_id="789", name="C", error=True)
    preview = call("backup.preview", id=identity, categories=["artists"])
    call("backup.restore", id=identity, categories=["artists"], token=preview["token"])
    assert len(call("artists.list")["artists"]) == 1


def test_epoch_blocks_old_tasks_and_prepared_write_recovers(library):
    root, _, call = library
    payload = {"_base_dir": str(root)}
    old = RecoverySession(payload, "settings.save", lambda _: None)
    call("settings.save", settings={"theme": "dark"})
    identity = call("backup.create")["id"]
    preview = call("backup.preview", id=identity, categories=["settings"])
    call("backup.restore", id=identity, categories=["settings"], token=preview["token"])
    with pytest.raises(ValueError, match="restored"), old.guard():
        pass
    old.store.close()
    session = RecoverySession(payload, "settings.save", lambda _: None)
    before = json.loads(session.settings.read_text())
    body = {"writes": [{"kind": "json", "path": str(session.settings), "before": before, "after": {"theme": "light"}}]}
    operation = session.store.prepare(session.dataset, "settings.save", "settings", body)
    session.store.close()
    assert call("settings.get")["settings"]["theme"] == "light"
    with sqlite3.connect(root / ".pixiv-pbd-manager/recovery.sqlite3") as connection:
        assert connection.execute("SELECT state FROM operations WHERE id=?", (operation,)).fetchone()[0] == "committed"


def test_daily_dedup_retention_and_manual_backups_survive(library):
    root, _, call = library
    from pixiv_pbd_manager.recovery.archive import create_archive
    session = RecoverySession({"_base_dir": str(root)}, "test", lambda _: None)
    with session:
        for _ in range(17):
            with session.guard(), session.suspended():
                create_archive(session, "daily", "daily")
        entries = call("backup.list")["backups"]
        assert sum(row["kind"] == "daily" for row in entries) == 1
        manual = create_archive(session, "manual", "manual")
        for _ in range(23):
            create_archive(session, "checkpoint", "test", ["settings"])
    entries = call("backup.list")["backups"]
    assert sum(row["kind"] == "checkpoint" for row in entries) == 20
    assert any(row["id"] == manual for row in entries)


def test_checkpoint_failure_blocks_batch_and_warning_survives(library, monkeypatch):
    _, images, call = library
    from pixiv_pbd_manager.recovery import session as module
    def fail(*_args, **_kwargs):
        raise OSError("No space left")
    monkeypatch.setattr(module, "create_archive", fail)
    call("library.update_metadata", paths=[str(images / "one.png")], rating=1)
    assert "No space" in call("backup.list")["warning"]
    call("library.update_metadata", paths=[str(path) for path in images.iterdir()], rating=5, error=True)
    assert sorted(image["rating"] for image in call("library.list")["images"]) == [0, 1]


def test_cancelled_backup_never_publishes_partial_archive(library, monkeypatch):
    root, _, call = library
    monkeypatch.setattr("pixiv_pbd_manager.gui_api.runtime.CONTROL.is_cancelled", lambda: True)
    assert "cancelled" in call("backup.create", error=True)
    assert call("backup.list")["backups"] == []
    assert list((root / ".pixiv-pbd-manager/backups").glob("*.tmp")) == []


def test_external_backup_duplicate_images_require_manual_matching(library, tmp_path):
    root, images, call = library
    saved = call("library.update_metadata", paths=[str(images / "one.png")], rating=5)["images"][0]
    call("library.annotations.protect")
    identity = call("backup.create")["id"]
    from pixiv_pbd_manager.recovery.restore import build_restore
    with RecoverySession({"_base_dir": str(root), "library_index": str(tmp_path / "other.json")}, "backup.preview", lambda _: None) as session:
        from pixiv_pbd_manager.library.catalog import LibraryImage
        with AnnotationStore(session.index) as store:
            for path in images.iterdir():
                store.insert(LibraryImage(path=str(path), size_bytes=path.stat().st_size, mtime_ns=path.stat().st_mtime_ns,
                                          width=10, height=20, format="png"))
        preview, writes = build_restore(session, root / ".pixiv-pbd-manager/backups" / f"{identity}.zip", ["annotations"])
        assert preview["changes"][0]["unlinked"] == 1
        assert writes[0]["records"][0]["id"] != saved["image_id"]
        session.commit("restore", {"writes": writes, "invalidate": ["annotations"]})
        with AnnotationStore(session.index) as store:
            assert all(row["body"]["rating"] == 0 for row in store.records() if row["binding_key"])
            assert store.status()["unlinked"] == 1


def test_import_rejects_sqlite_triggers_and_checksum_tampering(library):
    root, _, call = library
    identity = call("backup.create")["id"]
    source = root / ".pixiv-pbd-manager/backups" / f"{identity}.zip"
    with ZipFile(source) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    malicious = root / "trigger.sqlite3"
    malicious.write_bytes(files["annotations.sqlite3"])
    with sqlite3.connect(malicious) as connection:
        connection.execute("CREATE TRIGGER unsafe AFTER UPDATE ON images BEGIN DELETE FROM images; END")
    files["annotations.sqlite3"] = malicious.read_bytes()
    from pixiv_pbd_manager.recovery.archive import digest
    manifest = json.loads(files["manifest.json"])
    manifest["files"]["annotations.sqlite3"].update(size=len(files["annotations.sqlite3"]), sha256=digest(files["annotations.sqlite3"]))
    files["manifest.json"] = json.dumps(manifest).encode()
    bad = root / "trigger.zip"
    with ZipFile(bad, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    assert "schema" in call("backup.import", path=str(bad), error=True)
    files["settings.json"] = b'{"theme":"dark"}'
    with ZipFile(bad, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    call("backup.import", path=str(bad), error=True)


def test_partial_multicategory_restore_completes_after_restart(library, monkeypatch):
    root, images, call = library
    call("settings.save", settings={"theme": "dark"})
    call("library.update_metadata", paths=[str(images / "one.png")], rating=5)
    identity = call("backup.create")["id"]
    call("settings.save", settings={"theme": "light"})
    call("library.update_metadata", paths=[str(images / "one.png")], rating=1)
    preview = call("backup.preview", id=identity, categories=["settings", "annotations"])
    from pixiv_pbd_manager.recovery import transactions
    original = transactions.apply_writes
    def crash(writes, reverse=False):
        original(writes[:1], reverse)
        raise SystemExit("injected process death")
    with monkeypatch.context() as patch:
        patch.setattr(transactions, "apply_writes", crash)
        with pytest.raises(SystemExit):
            call("backup.restore", id=identity, categories=["settings", "annotations"], token=preview["token"])
    assert call("settings.get")["settings"]["theme"] == "dark"
    assert next(row for row in call("library.list")["images"] if row["path"].endswith("one.png"))["rating"] == 5


def test_rollback_on_normal_write_failure_keeps_all_categories(library, monkeypatch):
    _, images, call = library
    call("settings.save", settings={"theme": "dark"})
    identity = call("backup.create")["id"]
    call("settings.save", settings={"theme": "light"})
    call("library.update_metadata", paths=[str(images / "one.png")], rating=5)
    preview = call("backup.preview", id=identity, categories=["settings", "annotations"])
    from pixiv_pbd_manager.recovery import transactions
    original = transactions._annotations
    def fail(write, reverse):
        if not reverse:
            raise OSError("disk write failed")
        return original(write, reverse)
    with monkeypatch.context() as patch:
        patch.setattr(transactions, "_annotations", fail)
        call("backup.restore", id=identity, categories=["settings", "annotations"], token=preview["token"], error=True)
    assert call("settings.get")["settings"]["theme"] == "light"
    assert next(row for row in call("library.list")["images"] if row["path"].endswith("one.png"))["rating"] == 5


def test_history_finalization_failure_rolls_back_data_and_undo(library, monkeypatch):
    _, images, call = library
    path = str(images / "one.png")
    call("library.update_metadata", paths=[path], rating=5)
    identity = call("history.list")["latest_id"]
    from pixiv_pbd_manager.recovery.store import RecoveryStore
    original = RecoveryStore.finish
    def fail_after_finish(store, operation):
        original(store, operation)
        raise OSError("injected history commit failure")
    with monkeypatch.context() as patch:
        patch.setattr(RecoveryStore, "finish", fail_after_finish)
        call("history.undo", id=identity, error=True)
    assert call("history.list")["latest_id"] == identity
    assert next(row for row in call("library.list")["images"] if row["path"] == path)["rating"] == 5
    call("history.undo", id=identity)


def test_custom_paths_isolate_dataset_history_and_backups(library):
    root, _, call = library
    call("artists.add", artist_id="123", name="A")
    original = call("backup.create")["id"]
    custom = {"database": str(root / "custom artists.json"), "library_index": str(root / "custom index.json")}
    call("artists.add", artist_id="456", name="B", **custom)
    identity = call("backup.create", **custom)["id"]
    assert {row["id"] for row in call("backup.list", **custom)["backups"]} >= {identity}
    assert original not in {row["id"] for row in call("backup.list", **custom)["backups"]}
    assert identity not in {row["id"] for row in call("backup.list")["backups"]}
    assert [row["id"] for row in call("artists.list")["artists"]] == ["123"]


def test_backup_only_operations_have_history_but_no_undo(library):
    _, _, call = library
    call("artists.add", artist_id="123", name="A")
    call("artists.remove", artist_ids=["123"])
    history = call("history.list")
    assert history["latest_id"] is None
    assert history["entries"][0]["state"] == "backup_only"


def test_managed_symlink_is_not_followed_when_deleting(library, monkeypatch):
    root, _, call = library
    identity = call("backup.create")["id"]
    path = root / ".pixiv-pbd-manager/backups" / f"{identity}.zip"
    original = Path.is_symlink
    monkeypatch.setattr(Path, "is_symlink", lambda value: value == path or original(value))
    assert "Invalid managed" in call("backup.delete", id=identity, error=True)
    assert path.exists()


@pytest.mark.parametrize("kind", ["version", "link", "size", "duplicate"])
def test_invalid_archive_boundaries_are_rejected(library, monkeypatch, kind):
    root, _, call = library
    from zipfile import ZipInfo
    from pixiv_pbd_manager.recovery import archive as module
    source = root / "invalid.zip"
    with ZipFile(source, "w") as archive:
        if kind == "link":
            info = ZipInfo("manifest.json")
            info.external_attr = 0o120777 << 16
            archive.writestr(info, "{}")
        else:
            archive.writestr("manifest.json", '{"version":99,"files":{}}')
        if kind == "duplicate":
            with pytest.warns(UserWarning):
                archive.writestr("manifest.json", "{}")
    if kind == "size":
        monkeypatch.setattr(module, "MAX_BYTES", 1)
    call("backup.import", path=str(source), error=True)
    assert call("backup.list")["backups"] == []


def test_settings_import_preserves_local_runtime_and_validates_shapes(library):
    root, _, call = library
    settings = {"theme": "dark", "browser": "old-browser", "user_data_dir": "old-profile"}
    prefs = {"librarySort": {"key": "filename", "direction": "asc"}, "similarRoots": "old-folder",
             "librarySidebarWidth": 300, "artistsColWidths": {"name": 180}, "windowState": {"width": 1180, "height": 800}}
    call("settings.save", settings=settings, ui_preferences=prefs)
    identity = call("backup.create")["id"]
    call("backup.export", id=identity, path=str(root / "portable.zip"))
    imported = call("backup.import", path=str(root / "portable.zip"))["id"]
    call("settings.save", settings={"theme": "light", "browser": "local-browser", "user_data_dir": "local-profile"})
    preview = call("backup.preview", id=imported, categories=["settings"])
    assert "old-folder" in preview["invalid_paths"]
    call("backup.restore", id=imported, categories=["settings"], token=preview["token"])
    restored = call("settings.get")["settings"]
    assert restored["browser"] == "local-browser" and restored["user_data_dir"] == "local-profile"
    assert restored["theme"] == "dark" and restored["ui_preferences"] == prefs
    from pixiv_pbd_manager.recovery.policy import clean_settings
    for malformed in [{"download_roots": "not-a-list"}, {"delay": float("nan")},
                      {"ui_preferences": {"artistsColWidths": {"name": "bad"}}}, {"theme": "invalid"}]:
        with pytest.raises(ValueError):
            clean_settings(malformed)


def test_cache_invalidation_failure_does_not_hide_committed_restore(library, monkeypatch):
    root, _, call = library
    call("settings.save", settings={"theme": "dark"})
    identity = call("backup.create")["id"]
    call("settings.save", settings={"theme": "light"})
    preview = call("backup.preview", id=identity, categories=["settings"])
    from pixiv_pbd_manager.library.catalog import library_index_metadata_path
    metadata = library_index_metadata_path(root / ".pixiv-pbd-manager/library_index.json")
    original = Path.unlink
    def fail_cache(path, *args, **kwargs):
        if path == metadata:
            raise PermissionError("read-only cache")
        return original(path, *args, **kwargs)
    monkeypatch.setattr(Path, "unlink", fail_cache)
    result = call("backup.restore", id=identity, categories=["settings"], token=preview["token"])
    assert result["restored"] == ["settings"]
    assert call("settings.get")["settings"]["theme"] == "dark"
