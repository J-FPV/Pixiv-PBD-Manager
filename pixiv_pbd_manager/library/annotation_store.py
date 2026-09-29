"""Transactional, non-rebuildable user annotations, independent of the catalog."""

from __future__ import annotations

from contextlib import contextmanager, nullcontext
import json
import os
from pathlib import Path
import sqlite3
import time
from tempfile import NamedTemporaryFile
from uuid import uuid4

from .catalog import LibraryImage, _clean_markers, _clean_rating, _clean_tags


EMPTY = {"tags": [], "favorite": False, "rating": 0, "markers": []}


def annotation_path(index_path: Path) -> Path:
    return index_path.with_name(f"{index_path.stem}.annotations.sqlite3")


def path_key(path: str | Path) -> str:
    return os.path.normcase(os.path.normpath(str(path)))


def signature(path: str | Path) -> list:
    stat = Path(path).stat()
    return [stat.st_size, stat.st_mtime_ns, str(stat.st_dev), str(stat.st_ino)]


def same_signature(left: list, right: list) -> bool:
    return left[:2] == right[:2] and (not left[2] or left[2:] == right[2:])


def metadata(image: LibraryImage) -> dict:
    return {"tags": list(image.tags), "favorite": bool(image.favorite),
            "rating": int(image.rating), "markers": list(image.markers)}


def apply_patch_values(body: dict, patch: dict, pixiv_tags: list | None = None) -> dict:
    body = dict(body)
    if "tags" in patch:
        body["tags"] = _clean_tags(patch["tags"])
    tags = set(body["tags"])
    tags.update(_clean_tags(patch.get("add_tags")))
    tags.difference_update(_clean_tags(patch.get("remove_tags")))
    if patch.get("copy_pixiv_tags"):
        tags.update(item["tag"] for item in pixiv_tags or [] if item.get("tag"))
    body["tags"] = sorted(tags)
    if "favorite" in patch:
        body["favorite"] = bool(patch["favorite"])
    if "rating" in patch:
        body["rating"] = _clean_rating(patch["rating"])
    markers = set(_clean_markers(patch.get("markers", body["markers"])))
    if "markers" not in patch:
        markers.update(_clean_markers(patch.get("add_markers")))
        markers.difference_update(_clean_markers(patch.get("remove_markers")))
    body["markers"] = sorted(markers)
    return body


class AnnotationStore:
    def __init__(self, index_path: Path):
        self.index_path = index_path
        self.path = annotation_path(index_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        existed = self.path.exists()
        raw = None
        if index_path.exists():
            try:
                raw = json.loads(index_path.read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                if not existed:
                    raise RuntimeError("Cannot migrate unreadable library index; restore its backup first") from exc
        if not existed and raw and int(raw.get("version", 1)) >= 3 and raw.get("annotation_store_id"):
            raise RuntimeError("Annotation database is missing; restore it before rebuilding the library")
        self.connection = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        self.connection.row_factory = sqlite3.Row
        try:
            self.connection.execute("PRAGMA synchronous=FULL")
            with self.transaction():
                tables = self.connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
                # A cancelled first migration can leave a valid empty SQLite file.
                if not tables and not (raw and raw.get("annotation_store_id")):
                    self.connection.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
                    self.connection.execute("""CREATE TABLE images (
                        id TEXT PRIMARY KEY, path TEXT NOT NULL, binding_key TEXT UNIQUE,
                        signature TEXT NOT NULL, sha256 TEXT NOT NULL DEFAULT '',
                        root TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'linked',
                        error TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
                        revision INTEGER NOT NULL DEFAULT 0, binding_revision INTEGER NOT NULL DEFAULT 0
                    )""")
                    self.connection.execute("CREATE INDEX image_hash ON images(sha256)")
                    self.connection.executemany("INSERT INTO meta VALUES (?, ?)",
                                                [("version", "1"), ("store_id", uuid4().hex)])
                if self.get_meta("version") != "1":
                    raise RuntimeError("Unsupported annotation database version")
                if "first_seen_ns" not in {row[1] for row in self.connection.execute("PRAGMA table_info(images)")}:
                    self.connection.execute("ALTER TABLE images ADD COLUMN first_seen_ns INTEGER")
                self.store_id = self.get_meta("store_id")
                if raw and raw.get("annotation_store_id") not in (None, "", self.store_id):
                    raise RuntimeError("Library index belongs to another annotation database")
                if not self.get_meta("legacy_imported"):
                    if raw and int(raw.get("version", 1)) < 3:
                        backup = index_path.with_name(f"{index_path.name}.pre-annotations.bak")
                        if not backup.exists():
                            temporary = None
                            try:
                                with NamedTemporaryFile(dir=backup.parent, delete=False) as stream:
                                    temporary = Path(stream.name)
                                    stream.write(index_path.read_bytes())
                                    stream.flush()
                                    os.fsync(stream.fileno())
                                os.replace(temporary, backup)
                            finally:
                                if temporary:
                                    temporary.unlink(missing_ok=True)
                        for key, value in (raw.get("entries") or {}).items():
                            image = LibraryImage.from_json({**value, "path": value.get("path") or key})
                            self.insert(image, body=metadata(image))
                    self.connection.execute("INSERT INTO meta VALUES ('legacy_imported', '1')")
        except BaseException:
            self.connection.close()
            raise

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.connection.close()

    @contextmanager
    def transaction(self):
        from ..recovery import active
        session = active()
        with session.guard() if session else nullcontext():
            self.connection.execute("BEGIN IMMEDIATE")
            try:
                yield
                self.connection.execute("COMMIT")
            except BaseException:
                self.connection.execute("ROLLBACK")
                raise

    def get_meta(self, key: str) -> str:
        row = self.connection.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return row[0] if row else ""

    @staticmethod
    def decode(row) -> dict | None:
        if row is None:
            return None
        value = dict(row)
        value["body"] = json.loads(value["body"])
        value["signature"] = json.loads(value["signature"])
        return value

    def records(self) -> list[dict]:
        return [self.decode(row) for row in self.connection.execute("SELECT * FROM images")]

    def get(self, image_id: str) -> dict | None:
        return self.decode(self.connection.execute("SELECT * FROM images WHERE id=?", (image_id,)).fetchone())

    def at_path(self, path: str) -> dict | None:
        return self.decode(self.connection.execute("SELECT * FROM images WHERE binding_key=?", (path_key(path),)).fetchone())

    def insert(self, image: LibraryImage, *, body: dict | None = None, sig: list | None = None, root: str = "", discovered=False) -> str:
        body = body or dict(EMPTY)
        image_id = uuid4().hex
        self.connection.execute(
            """INSERT OR IGNORE INTO images(id,path,binding_key,signature,body,revision,root,first_seen_ns)
               VALUES (?,?,?,?,?,?,?,?)""",
            (image_id, image.path, path_key(image.path),
             json.dumps(sig or [image.size_bytes, image.mtime_ns, "", ""]),
             json.dumps(body, ensure_ascii=True), int(body != EMPTY), root, time.time_ns() if discovered else None),
        )
        return self.at_path(image.path)["id"]

    def ensure(self, images) -> list[dict]:
        rows = self.records()
        known = {row["binding_key"] for row in rows if row["binding_key"]}
        identities = {row["id"] for row in rows}
        historical = {path_key(row["path"]) for row in rows if not row["binding_key"]}
        missing = [image for image in images if path_key(image.path) not in known
                   and image.image_id not in identities and path_key(image.path) not in historical]
        if missing:
            with self.transaction():
                for image in missing:
                    self.insert(image)
            return self.records()
        return rows

    def overlay(self, images, records: list[dict] | None = None) -> None:
        images = list(images)
        if records is None:
            records = ([row for image in images if (row := self.at_path(image.path))]
                       if len(images) <= 100 else self.records())
        by_path = {row["binding_key"]: row for row in records if row["binding_key"]}
        for image in images:
            row = by_path.get(path_key(image.path))
            image.image_id = row["id"] if row else ""
            image.annotation_revision = row["revision"] if row else 0
            image.first_seen_ns = row["first_seen_ns"] if row else None
            body = row["body"] if row else EMPTY
            image.tags = list(body["tags"])
            image.favorite = body["favorite"]
            image.rating = body["rating"]
            image.markers = list(body["markers"])

    def status(self) -> dict:
        rows = self.connection.execute("""SELECT
            SUM(CASE WHEN revision>0 AND status='linked' AND sha256='' AND error='' THEN 1 ELSE 0 END),
            SUM(CASE WHEN revision>0 AND status='linked' AND sha256<>'' THEN 1 ELSE 0 END),
            SUM(CASE WHEN revision>0 AND status IN ('missing','changed','unverified') THEN 1 ELSE 0 END),
            SUM(CASE WHEN revision>0 AND status='linked' AND error<>'' THEN 1 ELSE 0 END) FROM images""").fetchone()
        return dict(zip(("pending", "protected", "unlinked", "errors"), [int(value or 0) for value in rows]))

    def detach(self, row: dict, state: str, error: str = "") -> None:
        self.connection.execute(
            """UPDATE images SET binding_key=NULL,status=?,error=?,binding_revision=binding_revision+1
               WHERE id=? AND binding_revision=?""", (state, error, row["id"], row["binding_revision"]),
        )

    def bind(self, row: dict, path: str, sig: list, root: str = "") -> None:
        self.connection.execute(
            """UPDATE images SET path=?,binding_key=?,signature=?,root=?,status='linked',error='',
               binding_revision=binding_revision+1 WHERE id=? AND binding_revision=?""",
            (path, path_key(path), json.dumps(sig), root, row["id"], row["binding_revision"]),
        )
