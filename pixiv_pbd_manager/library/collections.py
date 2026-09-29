"""Named organization only: members reference identities, never own media files."""

from contextlib import closing
import json
from pathlib import Path
import re
import sqlite3

from ..recovery.policy import canonical

FILTERS = {"artists", "folders", "tags", "favorites", "ratings", "markers", "formats", "orientations", "resolutions", "dates"}


def collection_path(index):
    return Path(index).with_name(f"{Path(index).stem}.collections.sqlite3")


def validate(body):
    if not isinstance(body, dict) or body.get("kind") not in ("smart", "project"):
        raise ValueError("Invalid collection")
    if not isinstance(body.get("id"), str) or not re.fullmatch(r"[0-9a-f]{32}", body["id"]):
        raise ValueError("Invalid collection identity")
    if not isinstance(body.get("name"), str) or not body["name"].strip() or len(body["name"]) > 120:
        raise ValueError("Collection name must contain 1-120 characters")
    if set(body) - {"id", "name", "kind", "filters", "sort", "members"}:
        raise ValueError("Unsupported collection fields")
    sort = body.get("sort", {"key": "modified", "direction": "desc"})
    if not isinstance(sort, dict) or sort.get("key") not in ("created", "modified", "filename", "size", "pixels", "rating") or sort.get("direction") not in ("asc", "desc"):
        raise ValueError("Invalid collection sort")
    filters = body.get("filters", {})
    if not isinstance(filters, dict) or set(filters) - FILTERS - {"keyword", "not_used", "added_within_days"}:
        raise ValueError("Unsupported smart collection filters")
    for key, value in filters.items():
        if key in FILTERS and (not isinstance(value, list) or len(value) > 30000 or any(not isinstance(item, str) for item in value)):
            raise ValueError("Invalid collection filter values")
        if key == "keyword" and not isinstance(value, str) or key == "not_used" and type(value) is not bool:
            raise ValueError("Invalid collection filter")
        if key == "added_within_days" and value is not None and (type(value) is not int or not 1 <= value <= 36500):
            raise ValueError("Invalid collection date window")
    members = body.get("members", [])
    if not isinstance(members, list) or len(members) > 100000:
        raise ValueError("Too many collection members")
    seen = set()
    for member in members:
        if not isinstance(member, dict) or set(member) - {"store_id", "image_id", "sha256", "size", "path", "pending"}:
            raise ValueError("Invalid collection member")
        if any(not isinstance(member.get(key), str) for key in ("store_id", "image_id", "sha256", "path")):
            raise ValueError("Invalid collection member identity")
        if not member["store_id"] or not member["image_id"] or type(member.get("size")) is not int or member["size"] < 0:
            raise ValueError("Invalid collection member identity")
        if member["sha256"] and not re.fullmatch(r"[0-9a-f]{64}", member["sha256"]):
            raise ValueError("Invalid member content hash")
        if "pending" in member and type(member["pending"]) is not bool:
            raise ValueError("Invalid pending member")
        identity = (member["store_id"], member["image_id"])
        if identity in seen:
            raise ValueError("Duplicate collection member")
        seen.add(identity)
    return {**body, "name": body["name"].strip(), "filters": filters, "sort": sort, "members": members}


class CollectionStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path, timeout=15)
        with self.connection:
            self.connection.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
            self.connection.execute("INSERT OR IGNORE INTO meta VALUES ('version','1')")
            self.connection.execute("CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, body TEXT NOT NULL)")
        if self.connection.execute("SELECT value FROM meta WHERE key='version'").fetchone()[0] != "1":
            self.connection.close()
            raise ValueError("Unsupported collection store version")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.connection.close()

    def all(self):
        return [json.loads(row[0]) for row in self.connection.execute("SELECT body FROM collections ORDER BY id")]

    def get(self, identity):
        row = self.connection.execute("SELECT body FROM collections WHERE id=?", (identity,)).fetchone()
        return json.loads(row[0]) if row else None


def read_backup(path):
    with closing(sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro&immutable=1", uri=True)) as connection:
        connection.execute("PRAGMA trusted_schema=OFF")
        for kind, name in connection.execute("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"):
            if kind not in ("table", "index") or kind == "table" and name not in ("meta", "collections"):
                raise ValueError("Unsupported collection backup schema")
        if dict(connection.execute("SELECT key,value FROM meta")).get("version") != "1":
            raise ValueError("Unsupported collection backup version")
        if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("Damaged collection backup")
        rows = []
        for identity, text in connection.execute("SELECT id,body FROM collections"):
            body = validate(json.loads(text))
            if body["id"] != identity:
                raise ValueError("Collection identity mismatch")
            rows.append(body)
        return rows


def apply_records(write, reverse=False):
    source, destination = ("after", "before") if reverse else ("before", "after")
    with CollectionStore(write["path"]) as store, store.connection:
        store.connection.execute("BEGIN IMMEDIATE")
        for record in write["records"]:
            current = store.get(record["id"])
            wanted = record[destination]
            if current == wanted:
                continue
            if current != record[source]:
                raise ValueError("Collection changed; refresh before retrying")
            if wanted is None:
                store.connection.execute("DELETE FROM collections WHERE id=?", (record["id"],))
            else:
                store.connection.execute("INSERT OR REPLACE INTO collections VALUES (?,?)", (record["id"], canonical(validate(wanted))))
