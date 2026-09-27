"""Validated, credential-free ZIP snapshots. Imported SQLite is never executed."""

from contextlib import closing
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import stat
from tempfile import TemporaryDirectory
from uuid import uuid4
from zipfile import ZipFile, ZIP_DEFLATED

from .policy import canonical, clean_settings
from .store import now

MAX_BYTES = 1024 ** 3
MEMBERS = {"manifest.json", "artists.json", "settings.json", "annotations.sqlite3"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path, *, missing=None):
    if not path.exists():
        return {} if missing is None else missing
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Invalid data file: {path}")
    return value


def artist_data(value):
    if not isinstance(value, dict) or not isinstance(value.get("artists", {}), dict) or not isinstance(value.get("tags", []), list):
        raise ValueError("Invalid artist database")
    from ..models import ArtistRecord
    result = {"version": 1, "tags": [str(tag) for tag in value.get("tags", [])], "artists": {}}
    for key, record in value.get("artists", {}).items():
        if not str(key).isdigit() or not isinstance(record, dict):
            raise ValueError("Invalid artist record")
        result["artists"][key] = ArtistRecord.from_json({**record, "id": key}).to_json()
    return result


def annotation_data(path):
    connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
    try:
        connection.execute("PRAGMA trusted_schema=OFF")
        schema = connection.execute("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").fetchall()
        if any(kind not in ("table", "index") or kind == "table" and name not in ("meta", "images") for kind, name in schema):
            raise ValueError("Unsupported annotation schema in backup")
        if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("Damaged annotation backup")
        meta = dict(connection.execute("SELECT key,value FROM meta"))
        if meta.get("version") != "1" or not isinstance(meta.get("store_id"), str) or not meta["store_id"]:
            raise ValueError("Unsupported annotation version")
        connection.row_factory = sqlite3.Row
        rows = []
        from ..library.annotation_store import apply_patch_values, EMPTY
        for record in connection.execute("SELECT id,path,signature,sha256,root,status,body,revision FROM images"):
            row = dict(record)
            row["signature"] = json.loads(row["signature"])
            sig = row["signature"]
            if (not isinstance(sig, list) or len(sig) != 4 or type(sig[0]) is not int or sig[0] < 0
                    or type(sig[1]) is not int or not all(isinstance(item, str) for item in sig[2:])):
                raise ValueError("Invalid image signature")
            if (not all(isinstance(row[key], str) for key in ("id", "path", "sha256", "root", "status"))
                    or not row["id"] or type(row["revision"]) is not int or row["revision"] < 0
                    or row["sha256"] and not re.fullmatch(r"[0-9a-f]{64}", row["sha256"])):
                raise ValueError("Invalid annotation identity")
            body = json.loads(row["body"])
            if not isinstance(body, dict):
                raise ValueError("Invalid annotation values")
            row["body"] = apply_patch_values(EMPTY, body)
            rows.append(row)
        return {"store_id": meta["store_id"], "records": rows}
    finally:
        connection.close()


def create_archive(session, kind, reason, categories=None):
    categories = categories or ["artists", "annotations", "settings"]
    identity = uuid4().hex
    folder = session.directory / "backups"
    folder.mkdir(exist_ok=True)
    target = folder / f"{identity}.zip"
    temp = target.with_suffix(".tmp")
    manifest = {"version": 1, "id": identity, "created": now(), "source": session.dataset,
                "kind": kind, "reason": reason, "files": {}}
    fingerprints = {}
    try:
        with TemporaryDirectory(prefix="pbd-backup-") as staging, ZipFile(temp, "w", ZIP_DEFLATED) as archive:
            for category in categories:
                session.check_cancel()
                if category == "annotations":
                    if not session.annotations.exists() and session.index.exists():
                        from ..library.annotation_store import AnnotationStore
                        with session.suspended(), AnnotationStore(session.index):
                            pass
                    if not session.annotations.exists():
                        continue
                    path = Path(staging) / "annotations.sqlite3"
                    with closing(sqlite3.connect(session.annotations.resolve().as_uri() + "?mode=ro", uri=True)) as source:
                        with closing(sqlite3.connect(path)) as destination:
                            source.backup(destination, pages=256, progress=lambda *_: session.check_cancel())
                    value = annotation_data(path)
                    # Only user values and identity affect backup deduplication.
                    fingerprints[category] = digest(canonical(value).encode())
                    data, name = path.read_bytes(), "annotations.sqlite3"
                else:
                    value = read_json(getattr(session, category))
                    value = artist_data(value) if category == "artists" else clean_settings(value)
                    data, name = canonical(value).encode(), f"{category}.json"
                    fingerprints[category] = digest(data)
                archive.writestr(name, data)
                manifest["files"][name] = {"category": category, "size": len(data), "sha256": digest(data)}
                session.progress(category)
            archive.writestr("manifest.json", canonical(manifest))
        session.check_cancel()
        with temp.open("r+b") as stream:
            import os
            os.fsync(stream.fileno())
        temp.replace(target)
        fingerprint = digest(canonical(fingerprints).encode())
        session.store.connection.execute("INSERT INTO backups VALUES (?,?,?,?,?,?,?,?,?)",
            (identity, session.dataset, manifest["created"], kind, reason, str(target), fingerprint,
             target.stat().st_size, canonical(sorted(fingerprints))))
        if kind == "daily":
            previous = session.store.connection.execute("SELECT fingerprint FROM backups WHERE dataset=? AND categories=? AND id<>? ORDER BY rowid DESC LIMIT 1", (session.dataset, canonical(sorted(fingerprints)), identity)).fetchone()
            if previous and previous[0] == fingerprint:
                session.store.connection.execute("DELETE FROM backups WHERE id=?", (identity,))
                target.unlink()
                return None
        rotate(session, kind)
        return identity
    finally:
        temp.unlink(missing_ok=True)


def rotate(session, kind):
    limit = {"daily": 14, "checkpoint": 20}.get(kind)
    if limit is None:
        return
    rows = session.store.connection.execute("SELECT id,path FROM backups WHERE dataset=? AND kind=? ORDER BY rowid DESC LIMIT -1 OFFSET ?", (session.dataset, kind, limit)).fetchall()
    for row in rows:
        delete_archive(session, row[0], row[1])


def managed_archive_path(session, identity, path):
    if not re.fullmatch(r"[0-9a-f]{32}", identity):
        raise ValueError("Invalid managed backup path")
    folder = (session.directory / "backups").resolve()
    expected = folder / f"{identity}.zip"
    if expected.is_symlink() or Path(path).resolve() != expected:
        raise ValueError("Invalid managed backup path")
    return expected


def delete_archive(session, identity, path):
    expected = managed_archive_path(session, identity, path)
    expected.unlink(missing_ok=True)
    session.store.connection.execute("DELETE FROM backups WHERE id=?", (identity,))


def inspect_archive(path):
    if path.stat().st_size > MAX_BYTES:
        raise ValueError("Oversized backup package")
    with ZipFile(path) as archive, TemporaryDirectory(prefix="pbd-import-") as staging:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if (len(entries) > 64 or len(names) != len(set(names)) or set(names) - MEMBERS
                or "manifest.json" not in names or sum(entry.file_size for entry in entries) > MAX_BYTES):
            raise ValueError("Unsafe or oversized backup package")
        for entry in entries:
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode) or entry.flag_bits & 1 or entry.file_size > max(1024 * 1024, entry.compress_size * 1000):
                raise ValueError("Unsafe compressed backup member")
        manifest = json.loads(archive.read("manifest.json"))
        if not isinstance(manifest, dict) or manifest.get("version") != 1 or not isinstance(manifest.get("files"), dict):
            raise ValueError("Unsupported backup version")
        if set(manifest["files"]) != set(names) - {"manifest.json"}:
            raise ValueError("Backup manifest does not match package")
        values = {}
        for name, expected in manifest["files"].items():
            if not isinstance(expected, dict):
                raise ValueError("Invalid backup manifest entry")
            data = archive.read(name)
            category = {"artists.json": "artists", "settings.json": "settings", "annotations.sqlite3": "annotations"}[name]
            if expected.get("category") != category or expected.get("size") != len(data) or expected.get("sha256") != digest(data):
                raise ValueError("Backup checksum mismatch")
            if category == "annotations":
                temporary = Path(staging) / name
                temporary.write_bytes(data)
                values[category] = annotation_data(temporary)
            else:
                value = json.loads(data)
                values[category] = artist_data(value) if category == "artists" else clean_settings(value)
        return manifest, values
