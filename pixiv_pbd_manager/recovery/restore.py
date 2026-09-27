"""Restore user values without rewinding the current media lifecycle."""

import base64
from collections import defaultdict
import json
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from .archive import artist_data, digest, inspect_archive, read_json
from .policy import canonical, changes, clean_settings


def annotation_changes(session, saved):
    from ..library.annotation_store import AnnotationStore, EMPTY, same_signature
    from ..library.annotation_identity import verified_hash
    with session.suspended(), AnnotationStore(session.index) as store:
        current = {row["id"]: row for row in store.records()}
        same = saved["store_id"] == store.store_id
        result, consumed = [], set()
        candidates = defaultdict(list)
        source_hashes = defaultdict(list)
        if not same:
            for row in saved["records"]:
                if row["sha256"] and row["revision"]:
                    source_hashes[(row["signature"][0], row["sha256"])].append(row["id"])
            sizes = {key[0] for key in source_hashes}
            for row in current.values():
                session.check_cancel()
                if row["binding_key"] and row["status"] == "linked" and row["signature"][0] in sizes:
                    try:
                        hashed, sig = verified_hash(row["path"], session.check_cancel)
                        if same_signature(row["signature"], sig):
                            candidates[(sig[0], hashed)].append(row)
                    except (OSError, ValueError):
                        pass
        for row in saved["records"]:
            target = current.get(row["id"]) if same else None
            if not same and row["sha256"]:
                key = (row["signature"][0], row["sha256"])
                matches = candidates[key]
                if len(matches) == len(source_hashes[key]) == 1:
                    target = matches[0]
            if target:
                consumed.add(target["id"])
                if target["body"] != row["body"]:
                    result.append({"id": target["id"], "label": target["path"], "before": target["body"], "after": row["body"]})
            elif row["revision"]:
                identity = row["id"] if same else uuid5(NAMESPACE_URL, f"pbd:{saved['store_id']}:{row['id']}").hex
                existing = current.get(identity)
                consumed.add(identity)
                if not existing or existing["body"] != row["body"]:
                    result.append({"id": identity, "label": row["path"], "before": existing["body"] if existing else None,
                                   "after": row["body"], "detail": row})
        for row in current.values():
            if row["id"] not in consumed and row["body"] != EMPTY:
                result.append({"id": row["id"], "label": row["path"], "before": row["body"], "after": EMPTY})
        return result


def build_restore(session, path, categories):
    manifest, values = inspect_archive(path)
    entry = session.store.connection.execute("SELECT kind FROM backups WHERE path=?", (str(path),)).fetchone()
    imported = bool(entry and entry[0] == "imported")
    if not categories or set(categories) - values.keys():
        raise ValueError("Select available backup categories")
    writes, summaries, invalid_paths, details = [], [], set(), []
    for category in categories:
        session.check_cancel()
        saved = values[category]
        if category == "annotations":
            records = annotation_changes(session, saved)
            writes.append({"kind": "annotations", "path": str(session.annotations), "records": records})
            summaries.append({"category": category, "changed": len(records), "unlinked": sum(record.get("before") is None for record in records)})
            details.extend({"category": category, "label": record["label"], "before": record["before"], "after": record["after"]} for record in records[:50])
        else:
            target = getattr(session, category)
            corrupt = None
            try:
                before = read_json(target)
                if category == "artists":
                    artist_data(before)
            except (ValueError, OSError):
                corrupt = base64.b64encode(target.read_bytes()).decode() if target.exists() else None
                before = artist_data({}) if category == "artists" else {}
            if category == "settings":
                saved = clean_settings(saved)
                for key in ("browser", "user_data_dir"):
                    if imported or manifest.get("source") != session.dataset:
                        saved.pop(key, None)
                        if key in before:
                            saved[key] = before[key]
                if "database" in before:
                    saved["database"] = before["database"]
                candidates = [*saved.get("download_roots", []), *saved.get("exclude_roots", [])]
                for key in ("similarRoots", "similarExcludes"):
                    candidates.extend((saved.get("ui_preferences", {}).get(key) or "").splitlines())
                if saved.get("quarantine_dir"):
                    candidates.append(saved["quarantine_dir"])
            else:
                candidates = [path for artist in saved["artists"].values() for path in artist.get("save_paths", [])]
            invalid_paths.update(str(path) for path in candidates if path and not Path(path).exists())
            writes.append({"kind": "json", "path": str(target), "before": before, "after": saved, "corrupt_before": corrupt})
            deltas = changes(before, saved)
            changed = len({item["path"][1] if item["path"][0] == "artists" and len(item["path"]) > 1 else item["path"][0] for item in deltas})
            details.extend({"category": category, "label": ".".join(item["path"]), "before": item["before"], "after": item["after"]} for item in deltas[:50])
            summaries.append({"category": category, "changed": changed,
                              "damaged": bool(corrupt), "records": len(saved.get("artists", {})) if category == "artists" else len(saved)})
    token = digest(canonical({"archive": digest(path.read_bytes()), "writes": writes, "epoch": session.epoch}).encode())
    return {"token": token, "categories": categories, "changes": summaries, "details": details, "invalid_paths": sorted(invalid_paths),
            "source": manifest.get("source"), "created": manifest.get("created")}, writes
