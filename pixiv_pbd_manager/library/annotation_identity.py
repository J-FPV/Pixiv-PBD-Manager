"""Content verification and conservative, order-independent move matching."""

from __future__ import annotations

from collections import defaultdict
import hashlib
import json
from pathlib import Path

from .annotation_store import AnnotationStore, path_key, same_signature, signature


class ProtectionCancelled(Exception):
    pass


def verified_hash(path: str, should_cancel=None) -> tuple[str, list]:
    before = signature(path)
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            if should_cancel and should_cancel():
                raise ProtectionCancelled()
            digest.update(chunk)
    if signature(path) != before:
        raise ValueError("File changed during content verification")
    return digest.hexdigest(), before


def root_for(path: str, roots: list[Path]) -> str:
    candidates = [str(root) for root in roots if Path(path).is_relative_to(root)]
    return max(candidates, key=len, default="")


def is_absent(row: dict) -> bool:
    try:
        Path(row["path"]).stat()
        return False
    except FileNotFoundError:
        root = Path(row["root"]) if row["root"] else Path(row["path"]).parent
        for ancestor in (root, *root.parents):
            try:
                device = str(ancestor.stat().st_dev)
                # A missing folder is different from an offline volume. The
                # nearest accessible ancestor must still be on the old device.
                return device == row["signature"][2] if row["signature"][2] else not row["sha256"]
            except FileNotFoundError:
                continue
            except OSError:
                return False
        return False
    except OSError:
        return False


def path_missing(path: str) -> bool:
    try:
        Path(path).stat()
    except FileNotFoundError:
        return True
    except OSError:
        pass
    return False


def reconcile(store: AnnotationStore, images: list, roots: list[Path], should_cancel=None) -> list:
    """Only publish bindings after completing discovery and validating both sides."""
    old = store.records()
    by_path = {row["binding_key"]: row for row in old if row["binding_key"]}
    protected_paths = {path_key(row["path"]) for row in old if row["status"] in ("moving", "restoring", "quarantined")}
    current = {}
    assignments = {}
    detached = {}
    hashes = {}
    for image in images:
        if should_cancel and should_cancel():
            raise ProtectionCancelled()
        key = path_key(image.path)
        if key in protected_paths:
            continue
        try:
            sig = signature(image.path)
        except OSError:
            continue
        row = by_path.get(key)
        current[key] = (image, sig)
        if row:
            unchanged = same_signature(row["signature"], sig)
            if not unchanged and row["sha256"]:
                try:
                    digest, sig = verified_hash(image.path, should_cancel)
                    hashes[key] = digest
                    unchanged = digest == row["sha256"]
                    current[key] = (image, sig)
                except (OSError, ValueError):
                    unchanged = False
            if unchanged:
                assignments[key] = row
            else:
                detached[row["id"]] = (row, "changed")

    for row in old:
        if row["status"] == "linked" and row["binding_key"] not in current and is_absent(row):
            detached[row["id"]] = (row, "missing")

    # Existing copies that still have a location are never donors. A file-id
    # match can establish a directory rename even when the old root vanished.
    donors = []
    assigned_ids = {value["id"] for value in assignments.values()}
    for row in old:
        if not row["revision"] or not row["sha256"] or row["status"] not in ("linked", "missing", "changed"):
            continue
        if row["id"] in assigned_ids:
            continue
        if row["id"] in detached or row["status"] in ("missing", "changed") or path_missing(row["path"]):
            donors.append(row)
    by_content = defaultdict(list)
    for row in donors:
        by_content[(row["signature"][0], row["sha256"])].append(row)
    sizes = {size for size, _ in by_content}
    candidates = defaultdict(list)
    for key, (image, sig) in current.items():
        if key in assignments or sig[0] not in sizes:
            continue
        try:
            digest = hashes.get(key)
            if digest is None:
                digest, sig = verified_hash(image.path, should_cancel)
                hashes[key] = digest
                current[key] = (image, sig)
            candidates[(sig[0], digest)].append(key)
        except (OSError, ValueError):
            continue
    used = {row["id"] for row in assignments.values()}
    # Group instead of forming all donor/file pairs: a large set of identical
    # duplicates must stay linear in memory and remain ambiguous, not greedy.
    for content, rows in by_content.items():
        keys = candidates[content]
        physical_rows, physical_keys = defaultdict(list), defaultdict(list)
        for row in rows:
            if row["signature"][3] not in ("", "0"):
                physical_rows[tuple(row["signature"][2:])].append(row)
        for key in keys:
            physical_keys[tuple(current[key][1][2:])].append(key)
        for identity, matches in physical_rows.items():
            targets = physical_keys[identity]
            if len(matches) == len(targets) == 1:
                row, key = matches[0], targets[0]
                assignments[key] = row
                used.add(row["id"])
                detached.pop(row["id"], None)
        remaining_rows = [row for row in rows if row["id"] not in used]
        remaining_keys = [key for key in keys if key not in assignments]
        if len(remaining_rows) == len(remaining_keys) == 1:
            row, key = remaining_rows[0], remaining_keys[0]
            if is_absent(row) or row["id"] in detached and detached[row["id"]][1] == "changed":
                assignments[key] = row
                used.add(row["id"])
                detached.pop(row["id"], None)
    if should_cancel and should_cancel():
        raise ProtectionCancelled()
    with store.transaction():
        for row, state in detached.values():
            store.detach(row, state)
        # Release moved bindings before assigning replacements at their old paths.
        for key, row in assignments.items():
            if row["binding_key"] != key:
                store.connection.execute("UPDATE images SET binding_key=NULL WHERE id=? AND binding_revision=?",
                                         (row["id"], row["binding_revision"]))
        for key, (image, sig) in current.items():
            row = assignments.get(key)
            if row:
                # A cleanup or user write may have changed the binding while
                # hashing; never overwrite that more recent identity decision.
                fresh = store.get(row["id"])
                if fresh["binding_revision"] == row["binding_revision"]:
                    store.bind(row, image.path, sig, root_for(image.path, roots))
            elif not store.at_path(image.path):
                store.insert(image, sig=sig, root=root_for(image.path, roots))
    bound = {row[0] for row in store.connection.execute("SELECT binding_key FROM images WHERE binding_key IS NOT NULL")}
    result = [image for key, (image, _) in current.items() if key in bound]
    store.overlay(result)
    return result


def protect(store: AnnotationStore, roots: list[Path], *, retry=False, progress=None, should_cancel=None) -> dict:
    pending = [row for row in store.records() if row["revision"] and row["status"] == "linked"
               and not row["sha256"] and (retry or not row["error"])]
    cancelled = False
    for number, row in enumerate(pending, 1):
        if should_cancel and should_cancel():
            cancelled = True
            break
        try:
            digest, sig = verified_hash(row["path"], should_cancel)
            if not same_signature(row["signature"], sig):
                raise ValueError("File changed before annotation protection completed")
            with store.transaction():
                store.connection.execute(
                    """UPDATE images SET sha256=?,signature=?,root=?,error='',binding_revision=binding_revision+1
                       WHERE id=? AND binding_revision=? AND status='linked'""",
                    (digest, json.dumps(sig), root_for(row["path"], roots), row["id"], row["binding_revision"]),
                )
        except ProtectionCancelled:
            cancelled = True
            break
        except OSError as exc:
            with store.transaction():
                store.connection.execute("UPDATE images SET error=? WHERE id=? AND binding_revision=?",
                                         (str(exc), row["id"], row["binding_revision"]))
        except ValueError as exc:
            with store.transaction():
                # Preserve the original values rather than hashing a replacement.
                store.detach(row, "unverified", str(exc))
        if progress:
            progress(number, len(pending))
    return {**store.status(), "cancelled": cancelled}
