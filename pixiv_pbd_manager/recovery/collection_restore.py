"""Foreign members need unique content evidence; paths are descriptive only."""

from collections import defaultdict
from copy import deepcopy

from ..library.annotation_store import AnnotationStore, same_signature
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
                hashed, sig = verified_hash(row["path"], session.check_cancel)
                if same_signature(row["signature"], sig):
                    candidates[(sig[0], hashed)].append(row)
            except (OSError, ValueError):
                pass
        after = {}
        for collection in deepcopy(saved):
            for member in collection["members"]:
                if member["store_id"] == annotations.store_id:
                    member["pending"] = member["image_id"] not in identities
                else:
                    key = (member["size"], member["sha256"])
                    if member["sha256"] and len(sources[key]) == len(candidates[key]) == 1:
                        target = candidates[key][0]
                        member.update(store_id=annotations.store_id, image_id=target["id"], path=target["path"], pending=False)
                    else:
                        member["pending"] = True
            after[collection["id"]] = collection
        return [{"id": identity, "before": before.get(identity), "after": after.get(identity)}
                for identity in sorted(before.keys() | after.keys()) if before.get(identity) != after.get(identity)]
