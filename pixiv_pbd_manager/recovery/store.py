"""Durable catalog for snapshots and prepared/committed data writes."""

from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from uuid import uuid4

from .policy import canonical


def now():
    return datetime.now(timezone.utc).isoformat()


class RecoveryStore:
    def __init__(self, directory: Path):
        self.directory = directory
        directory.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(directory / "recovery.sqlite3", timeout=15, isolation_level=None)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA synchronous=FULL")
        self.connection.executescript("""
          CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          INSERT OR IGNORE INTO meta VALUES ('version','1');
          INSERT OR IGNORE INTO meta VALUES ('epoch','0');
          CREATE TABLE IF NOT EXISTS backups(
            id TEXT PRIMARY KEY,dataset TEXT,created TEXT,kind TEXT,reason TEXT,
            path TEXT,fingerprint TEXT,size INTEGER,categories TEXT);
          CREATE TABLE IF NOT EXISTS operations(
            id TEXT PRIMARY KEY,dataset TEXT,created TEXT,command TEXT,category TEXT,
            state TEXT,undoable INTEGER,body TEXT);
          CREATE TABLE IF NOT EXISTS notices(dataset TEXT PRIMARY KEY,message TEXT);
        """)
        if self.meta("version") != "1":
            raise ValueError("Unsupported recovery database version")

    def close(self):
        self.connection.close()

    def meta(self, key):
        row = self.connection.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return row[0] if row else ""

    def bump(self):
        self.connection.execute("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='epoch'")

    def notice(self, dataset, message):
        self.connection.execute("INSERT OR REPLACE INTO notices VALUES (?,?)", (dataset, message))

    def prepare(self, dataset, command, category, body, undoable=False):
        identity = uuid4().hex
        self.connection.execute("INSERT INTO operations VALUES (?,?,?,?,?,'prepared',?,?)",
                                (identity, dataset, now(), command, category, int(undoable), canonical(body)))
        return identity

    def finish(self, identity):
        self.connection.execute("UPDATE operations SET state='committed' WHERE id=?", (identity,))
        row = self.connection.execute("SELECT dataset FROM operations WHERE id=?", (identity,)).fetchone()
        self.connection.execute("""UPDATE operations SET state='expired' WHERE id IN (
            SELECT id FROM operations WHERE dataset=? AND state='committed' AND undoable=1
            ORDER BY rowid DESC LIMIT -1 OFFSET 20)""", (row[0],))
        # Only live undo entries and interrupted commits need full preimages.
        for item in self.connection.execute("SELECT id,body FROM operations WHERE dataset=? AND undoable=1 AND state NOT IN ('prepared','committed')", (row[0],)).fetchall():
            body = json.loads(item["body"])
            self.connection.execute("UPDATE operations SET body=? WHERE id=?", (canonical({"count": body.get("count", 1)}), item["id"]))
        old = self.connection.execute("""SELECT id,body FROM operations WHERE dataset=? AND state<>'prepared' AND id NOT IN (
            SELECT id FROM operations WHERE dataset=? ORDER BY rowid DESC LIMIT 80)
            AND NOT (undoable=1 AND state='committed')""", (row[0], row[0])).fetchall()
        for item in old:
            # A damaged original is evidence, not a disposable undo entry.
            if not any(write.get("corrupt_before") for write in json.loads(item["body"]).get("writes", [])):
                self.connection.execute("DELETE FROM operations WHERE id=?", (item["id"],))

    def history(self, dataset):
        result = []
        for row in self.connection.execute("SELECT * FROM operations WHERE dataset=? ORDER BY rowid DESC", (dataset,)):
            item = dict(row)
            body = json.loads(item.pop("body"))
            if not item["undoable"] and not body.get("show_history") and not body.get("invalidate"):
                continue
            if len(result) >= 60 and not (item["undoable"] and item["state"] == "committed"):
                continue
            if not item["undoable"] and item["state"] == "committed":
                item["state"] = "backup_only"
            item["count"] = body.get("count", 1)
            result.append(item)
        return result
