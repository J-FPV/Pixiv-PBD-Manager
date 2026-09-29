"""Snapshot and undo IPC. Archive paths are never used as restore destinations."""

import json
from pathlib import Path
import shutil
from uuid import uuid4

from ...recovery import active
from ...recovery.archive import create_archive, delete_archive, digest, inspect_archive, managed_archive_path, read_json
from ...recovery.policy import apply_deltas, canonical, changes
from ...recovery.restore import build_restore
from ...recovery.store import now


def _backup(session, identity):
    row = session.store.connection.execute("SELECT * FROM backups WHERE id=? AND dataset=?", (identity, session.dataset)).fetchone()
    if not row:
        raise ValueError("Backup is no longer available for this dataset")
    return managed_archive_path(session, row["id"], row["path"])


def list_backups(_payload, _emit):
    session = active()
    with session.guard():
        entries = [dict(row) for row in session.store.connection.execute("SELECT * FROM backups WHERE dataset=? ORDER BY rowid DESC", (session.dataset,))]
        for entry in entries:
            entry["categories"] = json.loads(entry["categories"])
            entry["available"] = Path(entry["path"]).is_file()
        notice = session.store.connection.execute("SELECT message FROM notices WHERE dataset=?", (session.dataset,)).fetchone()
        return {"backups": entries, "directory": str(session.directory / "backups"), "warning": notice[0] if notice else ""}


def create(_payload, _emit):
    session = active()
    with session.guard(), session.suspended():
        identity = create_archive(session, "manual", "manual")
    return {"id": identity}


def preview(payload, _emit):
    session = active()
    with session.guard():
        result, _writes = build_restore(session, _backup(session, payload.get("id")), payload.get("categories") or [])
        return result


def restore(payload, _emit):
    session = active()
    with session.guard():
        result, writes = build_restore(session, _backup(session, payload.get("id")), payload.get("categories") or [])
        if payload.get("token") != result["token"]:
            raise ValueError("Data changed after the preview; review the restore again")
        with session.suspended():
            # Damaged originals are retained in the durable restore journal;
            # valid categories also receive a normal pre-restore snapshot.
            valid = [change["category"] for change in result["changes"] if not change.get("damaged")]
            if valid:
                create_archive(session, "checkpoint", "backup.restore", valid)
        session.check_cancel()
        session.commit("restore", {"writes": writes, "invalidate": result["categories"]})
        _invalidate_index(session)
        return {"restored": result["categories"], "restart_required": True}


def _invalidate_index(session):
    from ...library.catalog import library_index_metadata_path
    try:
        library_index_metadata_path(session.index).unlink(missing_ok=True)
    except OSError as exc:
        # The durable commit is already complete. A disposable cache failure
        # must not report it as failed and leave the UI editing stale data.
        session.emit({"type": "log", "level": "error", "message": f"Data restored; index cache refresh failed: {exc}"})


def export(payload, _emit):
    session = active()
    target = Path(str(payload.get("path") or "")).expanduser().resolve()
    with session.guard():
        source = _backup(session, payload.get("id"))
        if target.exists() or target in session.resources or target.is_relative_to(session.directory):
            raise ValueError("Choose a new export filename outside the managed data directory")
        inspect_archive(source)
        with target.open("xb") as stream, source.open("rb") as original:
            shutil.copyfileobj(original, stream)
        return {"path": str(target)}


def import_backup(payload, _emit):
    session = active()
    source = Path(str(payload.get("path") or "")).expanduser().resolve()
    with session.guard():
        manifest, values = inspect_archive(source)
        session.check_cancel()
        identity = uuid4().hex
        directory = session.directory / "backups"
        directory.mkdir(exist_ok=True)
        target = directory / f"{identity}.zip"
        shutil.copyfile(source, target)
        try:
            # Verify the copied bytes too; the selected file may have changed.
            copied, _ = inspect_archive(target)
            if copied != manifest:
                raise ValueError("Backup package changed during import")
            session.store.connection.execute("INSERT INTO backups VALUES (?,?,?,?,?,?,?,?,?)", (identity, session.dataset,
                now(), "imported", "imported", str(target), digest(target.read_bytes()), target.stat().st_size, canonical(sorted(values))))
        except BaseException:
            target.unlink(missing_ok=True)
            raise
        return {"id": identity}


def delete(payload, _emit):
    session = active()
    with session.guard():
        path = _backup(session, payload.get("id"))
        delete_archive(session, payload["id"], path)
        return {"deleted": True}


def list_history(_payload, _emit):
    session = active()
    entries = session.store.history(session.dataset)
    latest = next((entry["id"] for entry in entries if entry["state"] == "committed"), None)
    return {"entries": entries, "latest_id": latest}


def _latest(session, identity):
    row = session.store.connection.execute("SELECT * FROM operations WHERE dataset=? AND state='committed' AND undoable=1 ORDER BY rowid DESC LIMIT 1", (session.dataset,)).fetchone()
    if not row or identity != row["id"]:
        raise ValueError("Only the most recent available operation can be undone")
    return row


def undo(payload, _emit):
    session = active()
    with session.guard():
        operation = _latest(session, payload.get("id"))
        body = json.loads(operation["body"])
        write = body["writes"][0]
        if operation["category"] == "collections":
            from ...library.collections import CollectionStore
            records = []
            with CollectionStore(session.collections) as store:
                for record in write["records"]:
                    if store.get(record["id"]) != record["after"]:
                        raise ValueError("Undo conflict: collection has changed")
                    records.append({"id": record["id"], "before": record["after"], "after": record["before"]})
            writes = [{"kind": "collections", "path": str(session.collections), "records": records}]
        elif operation["category"] == "annotations":
            from ...library.annotation_store import AnnotationStore
            with session.suspended(), AnnotationStore(session.index) as store:
                records = []
                for record in write["records"]:
                    row = store.get(record["id"])
                    if not row:
                        raise ValueError("Undo conflict: image record is missing")
                    restored = apply_deltas(row["body"], changes(record["before"], record["after"]), reverse=True)
                    records.append({"id": row["id"], "before": row["body"], "after": restored})
            writes = [{"kind": "annotations", "path": str(session.annotations), "records": records}]
        else:
            before = read_json(session.artists)
            after = apply_deltas(before, body["deltas"], reverse=True)
            writes = [{"kind": "json", "path": str(session.artists), "before": before, "after": after}]
        session.commit(operation["category"], {"writes": writes, "undo_id": operation["id"]})
        _invalidate_index(session)
        return {"undone": operation["id"], "category": operation["category"]}


def discard(payload, _emit):
    session = active()
    with session.guard():
        row = _latest(session, payload.get("id"))
        session.store.connection.execute("UPDATE operations SET state='discarded' WHERE id=?", (row["id"],))
        return {"discarded": row["id"]}
