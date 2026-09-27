"""Annotation operations shared by GUI commands and cleanup transactions."""

from __future__ import annotations

from contextlib import contextmanager
import json
from pathlib import Path

from .annotation_identity import verified_hash
from .annotation_store import AnnotationStore, apply_patch_values, path_key, same_signature, signature
from .catalog import load_library_index


@contextmanager
def annotated_catalog(index_path: Path):
    with AnnotationStore(index_path) as store:
        catalog = load_library_index(index_path)
        records = store.ensure(list(catalog.values()))
        unavailable = {row["id"] for row in records
                       if row["status"] in ("moving", "quarantined", "restoring", "deleting", "deleted")}
        catalog = {path: image for path, image in catalog.items() if image.image_id not in unavailable}
        store.overlay(catalog.values(), records)
        yield store, catalog


def update_annotations(store: AnnotationStore, images: list, patch: dict, identities: dict | None = None) -> None:
    verified = []
    for image in images:
        row = store.at_path(image.path)
        if not row or identities is not None and identities.get(image.path) != row["id"]:
            raise ValueError("Image identity changed; refresh the library before editing annotations")
        sig = signature(image.path)
        if not same_signature(row["signature"], sig):
            if not row["sha256"] or verified_hash(image.path)[0] != row["sha256"]:
                raise ValueError("Image content changed; scan the library before editing annotations")
        verified.append((image, row, sig))
    from ..recovery import active
    session = active()
    if session:
        with session.guard():
            updates = []
            for image, snapshot, _sig in verified:
                row = store.get(snapshot["id"])
                if row["binding_revision"] != snapshot["binding_revision"]:
                    raise ValueError("Image moved during annotation update; refresh and retry")
                updates.append((row["id"], row["body"], apply_patch_values(row["body"], patch, image.pixiv_tags)))
            session.annotation_write(store, updates)
        store.overlay(images)
        return
    with store.transaction():
        for image, snapshot, sig in verified:
            row = store.get(snapshot["id"])
            if row["binding_revision"] != snapshot["binding_revision"]:
                raise ValueError("Image moved during annotation update; refresh and retry")
            body = apply_patch_values(row["body"], patch, image.pixiv_tags)
            store.connection.execute(
                """UPDATE images SET body=?,revision=revision+1,signature=?,error='' WHERE id=?""",
                (json.dumps(body, ensure_ascii=True), json.dumps(sig), row["id"]),
            )
    store.overlay(images)


def recovery_list(store: AnnotationStore, catalog: dict, query: str = "", page: int = 1) -> dict:
    rows = [row for row in store.records() if row["revision"] and row["status"] in ("missing", "changed", "unverified")]
    needle = query.casefold().strip()
    rows = [row for row in rows if not needle or needle in (row["path"] + " " + " ".join(row["body"]["tags"])).casefold()]
    rows.sort(key=lambda row: (row["path"].casefold(), row["id"]))
    page = max(1, min(page, (len(rows) + 49) // 50))
    selected = rows[(page - 1) * 50:page * 50]
    candidates = [row for row in store.records() if row["binding_key"] and not row["revision"]
                  and row["path"] in catalog]
    return {"total": len(rows), "page": page, "page_size": 50, "entries": [
        {"image_id": row["id"], "old_path": row["path"], "reason": row["status"], "error": row["error"],
         "annotation_revision": row["revision"], "verified": bool(row["sha256"]), **row["body"],
         "candidate_ids": [candidate["id"] for candidate in candidates
                           if candidate["signature"][0] == row["signature"][0]][:20]}
        for row in selected], "annotation_status": store.status()}


def relink(store: AnnotationStore, source_id: str, target, revision: int, *,
           confirm_unverified=False, confirmed_sha256="") -> dict:
    source = store.get(source_id)
    destination = store.at_path(target.path)
    if not source or source["status"] not in ("missing", "changed", "unverified"):
        raise ValueError("Annotation record is no longer awaiting recovery")
    if not destination or destination["id"] != target.image_id:
        raise ValueError("Target image changed; refresh and retry")
    if destination["revision"]:
        raise ValueError("Target already has its own annotation record; nothing was overwritten")
    digest, sig = verified_hash(target.path)
    if not same_signature(destination["signature"], sig):
        raise ValueError("Target file changed since the scan; scan and select it again")
    if confirm_unverified and digest != confirmed_sha256:
        raise ValueError("Target content changed since confirmation; select it again")
    if digest != source["sha256"] and not confirm_unverified:
        return {"confirmation_required": True, "reason": "content_mismatch" if source["sha256"] else "unverified",
                "target_sha256": digest}
    with store.transaction():
        fresh = store.get(source_id)
        dest = store.get(destination["id"])
        if (fresh["revision"] != revision or fresh["binding_revision"] != source["binding_revision"]
                or dest["revision"] or dest["binding_revision"] != destination["binding_revision"]):
            raise ValueError("Annotations changed during recovery; refresh and retry")
        if signature(target.path) != sig:
            raise ValueError("Target file changed during recovery; select it again")
        store.detach(dest, "superseded")
        store.bind(fresh, target.path, sig, destination["root"])
        store.connection.execute("UPDATE images SET sha256=?,revision=revision+1 WHERE id=?", (digest, source_id))
    store.overlay([target])
    return {"confirmation_required": False, "annotation_status": store.status()}


def cleanup_annotation_move(store: AnnotationStore, item, state: str) -> None:
    """Keep annotations with the quarantined copy, never with another duplicate."""
    if state == "prepare":
        row = store.at_path(item.original_path)
        if row:
            item.library_image_id = row["id"]
            item.annotation_store_id = store.store_id
        return
    if not item.library_image_id or item.annotation_store_id != store.store_id:
        return
    row = store.get(item.library_image_id)
    if not row or row["status"] == state:
        return
    allowed = {
        "moving": {"linked"}, "quarantined": {"moving", "restoring", "deleting", "linked"},
        "restoring": {"quarantined"}, "linked": {"moving", "restoring", "quarantined"},
        "deleting": {"quarantined"}, "deleted": {"deleting", "quarantined"},
        "unverified": {"moving", "restoring", "deleting"},
    }
    if row["status"] not in allowed.get(state, set()):
        return
    if row["status"] == "linked" and path_key(row["path"]) != path_key(item.original_path):
        return
    path = item.original_path if state in ("linked", "restoring", "moving") else item.quarantine_path
    sig = row["signature"]
    digest = row["sha256"]
    verify_path = item.quarantine_path if state == "restoring" else path
    if state in ("moving", "quarantined", "restoring", "linked"):
        digest, sig = verified_hash(verify_path)
        if ((row["sha256"] and digest != row["sha256"])
                or (not row["sha256"] and state == "moving" and not same_signature(row["signature"], sig))):
            with store.transaction():
                store.detach(row, "unverified", "Cleanup file content no longer matches its annotations")
            if state in ("moving", "restoring"):
                raise ValueError("File content changed; annotation recovery requires confirmation")
            return
    with store.transaction():
        fresh = store.get(row["id"])
        if fresh["binding_revision"] != row["binding_revision"]:
            raise ValueError("Image identity changed during cleanup")
        if state == "linked":
            occupant = store.at_path(path)
            if occupant and occupant["id"] != row["id"]:
                if occupant["revision"]:
                    store.detach(row, "missing", "Restore target has an independent annotation record")
                    return
                store.detach(occupant, "superseded")
        store.connection.execute(
            """UPDATE images SET path=?,binding_key=?,signature=?,sha256=?,status=?,
               binding_revision=binding_revision+1 WHERE id=?""",
            (path, path_key(path) if state == "linked" else None, json.dumps(sig), digest, state, row["id"]),
        )
