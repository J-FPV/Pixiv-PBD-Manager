"""Foreign members need unique content evidence; paths are descriptive only."""

from collections import defaultdict
from copy import deepcopy

from ..library.annotation_store import AnnotationStore, same_signature, signature
from ..library.annotation_identity import verified_hash
from ..library.collections import CollectionStore


def collection_changes(session, saved):
    with CollectionStore(session.collections) as store, AnnotationStore(session.index) as annotations:
        before = {body["id"]: body for body in store.all()}
        rows = annotations.records()
        identities = {row["id"] for row in rows}
        sources, candidates = defaultdict(set), defaultdict(list)
        for collection in saved:
            for member in collection["members"]:
                if member["store_id"] != annotations.store_id and member["sha256"]:
                    sources[(member["size"], member["sha256"])].add((member["store_id"], member["image_id"]))
        sizes = {key[0] for key in sources}
        for row in rows:
            session.check_cancel()
            if row["status"] != "linked" or not row["binding_key"] or row["signature"][0] not in sizes:
                continue
            try:
                # A stored fingerprint holds while the file keeps its signature.
                if row["sha256"]:
                    hashed, sig = row["sha256"], signature(row["path"])
                else:
                    hashed, sig = verified_hash(row["path"], session.check_cancel)
                if same_signature(row["signature"], sig):
                    candidates[(sig[0], hashed)].append(row)
            except (OSError, ValueError):
                pass
        after = {}
        for collection in deepcopy(saved):
            members, seen = [], set()
            for member in collection["members"]:
                # Members only carry `pending` while unresolved, so an unchanged
                # collection compares equal to the live one.
                member.pop("pending", None)
                if member["store_id"] == annotations.store_id:
                    if member["image_id"] not in identities:
                        member["pending"] = True
                else:
                    key = (member["size"], member["sha256"])
                    if member["sha256"] and len(sources[key]) == len(candidates[key]) == 1:
                        target = candidates[key][0]
                        member.update(store_id=annotations.store_id, image_id=target["id"], path=target["path"])
                    else:
                        member["pending"] = True
                identity = (member["store_id"], member["image_id"])
                if identity in seen:
                    continue  # remapped by content onto an image the collection already holds
                seen.add(identity)
                members.append(member)
            collection["members"] = members
            after[collection["id"]] = collection
        return [{"id": identity, "before": before.get(identity), "after": after.get(identity)}
                for identity in sorted(before.keys() | after.keys()) if before.get(identity) != after.get(identity)]


def relink_pending(session):
    """Collections restored before the library held their images keep those
    members pending. After a full scan has bound the images, link each member
    that now has a unique verified match. Best effort: a concurrent edit or a
    cancel leaves the members pending for the next full scan."""
    if not session.collections.exists():
        return 0  # opening the store would create an empty one
    try:
        with CollectionStore(session.collections) as store:
            current = store.all()
        if not any(member.get("pending") for body in current for member in body["members"]):
            return 0
        # collection_changes reads the store again; a collection edited, added
        # or deleted in between must not be rewritten from the older snapshot.
        snapshot = {body["id"]: body for body in current}
        records = [record for record in collection_changes(session, current)
                   if record["before"] is not None and record["before"] == snapshot.get(record["id"])]
        if records:
            with session.guard():
                session.before_write("collections", len(records))
                session.commit("collections", {"writes": [{"kind": "collections", "path": str(session.collections),
                                                           "records": records}], "count": len(records)})
        return len(records)
    except (OSError, ValueError, RuntimeError):
        return 0
