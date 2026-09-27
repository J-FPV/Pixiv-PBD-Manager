"""Idempotent journal replay for JSON and annotation bodies, never media files."""

from contextlib import closing
import base64
import json
from pathlib import Path
import sqlite3

from .archive import read_json
from .policy import canonical


def _annotations(write, reverse):
    source, destination = ("after", "before") if reverse else ("before", "after")
    with closing(sqlite3.connect(write["path"], timeout=15)) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        for record in write["records"]:
            row = connection.execute("SELECT body FROM images WHERE id=?", (record["id"],)).fetchone()
            current = json.loads(row[0]) if row else None
            wanted = record[destination]
            if current == wanted:
                continue
            if current != record[source]:
                raise ValueError("Recovery conflict: annotation values changed")
            if wanted is None:
                connection.execute("DELETE FROM images WHERE id=?", (record["id"],))
            elif row:
                connection.execute("UPDATE images SET body=?,revision=revision+1 WHERE id=?", (canonical(wanted), record["id"]))
            else:
                detail = record["detail"]
                connection.execute("""INSERT INTO images(id,path,binding_key,signature,sha256,root,status,error,body,revision)
                    VALUES (?,?,NULL,?,?,?,'unverified','Restored annotation requires matching',?,1)""",
                    (record["id"], detail["path"], canonical(detail["signature"]), detail["sha256"], detail["root"], canonical(wanted)))


def apply_writes(writes, reverse=False):
    from ..paths import write_json_atomic
    source, destination = ("after", "before") if reverse else ("before", "after")
    for write in reversed(writes) if reverse else writes:
        if write["kind"] == "annotations":
            _annotations(write, reverse)
            continue
        path = Path(write["path"])
        if reverse and write.get("corrupt_before"):
            temporary = path.with_suffix(path.suffix + ".restore.tmp")
            temporary.write_bytes(base64.b64decode(write["corrupt_before"]))
            temporary.replace(path)
            continue
        try:
            current = read_json(path)
        except (ValueError, OSError):
            if not write.get("corrupt_before"):
                raise
            current = write[source]
        if "artists" in write[destination] or "artists" in write[source]:
            from .archive import artist_data
            current = artist_data(current)
        if current == write[destination]:
            continue
        # Artist serialization normalizes legacy records; compare normalized too.
        if current != write[source]:
            from .archive import artist_data
            if "artists" not in current or artist_data(current) != write[source]:
                raise ValueError("Recovery conflict: JSON values changed")
        write_json_atomic(path, write[destination])
