from pathlib import Path
from uuid import uuid4

from ...library.annotation_store import AnnotationStore, same_signature
from ...library.annotation_identity import verified_hash
from ...library.collections import CollectionStore, validate
from ...recovery import active
from ...recovery.policy import canonical
from ...recovery.archive import digest
from ...events import PROGRESS_COLLECTIONS
from ..runtime import CONTROL


def list_collections(payload, _emit):
    session = active()
    with session.guard(), CollectionStore(session.collections) as store, AnnotationStore(session.index) as annotations:
        records = {row["id"]: row for row in annotations.records()}
        values = []
        for body in store.all():
            result = {**body, "member_count": len(body["members"])}
            members = []
            requested = body["members"] if payload.get("id") == body["id"] else []
            if payload.get("id") == body["id"] and body["kind"] == "smart":
                requested = [{"store_id": annotations.store_id, "image_id": identity, "path": ""} for identity in dict.fromkeys(payload.get("image_ids", []))]
            for member in requested:
                row = records.get(member["image_id"]) if member["store_id"] == annotations.store_id and not member.get("pending") else None
                status = row["status"] if row else "pending"
                path = row["path"] if row else member["path"]
                if row and status == "linked" and not Path(path).is_file():
                    status = "unavailable" if row["root"] and not Path(row["root"]).is_dir() else "missing"
                members.append({**member, "path": path, "status": status, "available": status == "linked"})
            result["members"] = members
            result["revision"] = digest(canonical(body).encode())
            values.append(result)
        return {"collections": values, "store_id": annotations.store_id}


def _commit(session, before, after):
    if before == after:
        return
    if after is not None:
        after = validate(after)
    identity = (after or before)["id"]
    session.before_write("collections", max(1, abs(len((after or {}).get("members", [])) - len((before or {}).get("members", [])))))
    session.commit("collections", {"writes": [{"kind": "collections", "path": str(session.collections),
                                               "records": [{"id": identity, "before": before, "after": after}]}], "count": 1}, True)


def create(payload, _emit):
    session = active()
    body = {"id": uuid4().hex, "name": payload.get("name"), "kind": payload.get("kind"),
            "filters": payload.get("filters", {}), "sort": payload.get("sort", {"key": "modified", "direction": "desc"}), "members": []}
    with session.guard(), CollectionStore(session.collections):
        _commit(session, None, validate(body))
    return {"id": body["id"]}


def _get(store, payload):
    body = store.get(payload.get("id"))
    if not body:
        raise ValueError("Collection no longer exists")
    if payload.get("revision") is not None and payload["revision"] != digest(canonical(body).encode()):
        raise ValueError("Collection changed; refresh before editing")
    return body


def update(payload, _emit):
    session = active()
    with session.guard(), CollectionStore(session.collections) as store:
        before = _get(store, payload)
        after = {**before, **{key: payload[key] for key in ("name", "filters", "sort") if key in payload}}
        _commit(session, before, validate(after))
    return {"id": before["id"]}


def delete(payload, _emit):
    session = active()
    with session.guard(), CollectionStore(session.collections) as store:
        before = _get(store, payload)
        _commit(session, before, None)
    return {"deleted": True}


def add_members(payload, emit):
    session = active()
    with CollectionStore(session.collections) as store, AnnotationStore(session.index) as annotations:
        before = _get(store, payload)
        if before["kind"] != "project":
            raise ValueError("Only project collections have explicit members")
        if payload.get("store_id") != annotations.store_id:
            raise ValueError("Image store changed; reload before adding members")
        existing = {(member["store_id"], member["image_id"]) for member in before["members"]}
        members, snapshots = list(before["members"]), []
        wanted = list(dict.fromkeys(payload.get("image_ids", [])))
        for number, identity in enumerate(wanted):
            if CONTROL.is_cancelled():
                return {"cancelled": True}
            if (annotations.store_id, identity) in existing:
                continue
            row = annotations.get(identity)
            if not row:
                raise ValueError("Unknown image identity")
            hashed = row["sha256"]
            if row["status"] == "linked":
                # Verification happens outside the commit lock, then binding CAS
                # below rejects concurrent replacement/quarantine decisions.
                hashed, sig = verified_hash(row["path"], CONTROL.is_cancelled)
                if not same_signature(row["signature"], sig):
                    raise ValueError("Image changed; synchronize before adding it")
            snapshots.append(row)
            members.append({"store_id": annotations.store_id, "image_id": identity, "path": row["path"], "size": row["signature"][0], "sha256": hashed})
            emit({"type": "progress", "key": PROGRESS_COLLECTIONS, "payload": {"current": number + 1, "total": len(wanted)}})
        with session.guard():
            if store.get(before["id"]) != before or any(annotations.get(row["id"])["binding_revision"] != row["binding_revision"] for row in snapshots):
                raise ValueError("Collection or images changed; refresh before adding")
            # Keep verified fingerprints as derived identity data, including
            # images without annotations, so cross-volume moves can reconnect.
            hashes = {member["image_id"]: member["sha256"] for member in members}
            with annotations.transaction():
                for row in snapshots:
                    if hashes[row["id"]] and not row["sha256"]:
                        annotations.connection.execute("UPDATE images SET sha256=?,binding_revision=binding_revision+1 WHERE id=? AND binding_revision=?",
                                                       (hashes[row["id"]], row["id"], row["binding_revision"]))
            _commit(session, before, {**before, "members": members})
    return {"added": len(members) - len(before["members"])}


def remove_members(payload, _emit):
    session = active()
    with session.guard(), CollectionStore(session.collections) as store:
        before = _get(store, payload)
        identities = {(item["store_id"], item["image_id"]) for item in payload.get("members", [])}
        after = {**before, "members": [member for member in before["members"] if (member["store_id"], member["image_id"]) not in identities]}
        _commit(session, before, after)
    return {"removed": len(before["members"]) - len(after["members"])}
