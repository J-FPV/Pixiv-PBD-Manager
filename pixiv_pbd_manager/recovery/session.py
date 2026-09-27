"""Coordinate short commits; slow scans/network work never hold the write lock."""

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from . import ACTIVE
from .archive import artist_data, create_archive, read_json
from .locking import data_lock
from .policy import CHECKPOINTS, UNDO_ARTISTS, apply_deltas, canonical, changes
from .store import RecoveryStore


class RecoverySession:
    def __init__(self, payload, command, emit):
        from ..gui_api.payload import base_dir, db_path, resolve_path, settings_path
        from ..library.annotation_store import annotation_path
        from ..paths import DEFAULT_LIBRARY_INDEX, DATA_DIR
        self.payload, self.command, self.emit = payload, command, emit
        self.directory = base_dir(payload) / DATA_DIR
        (self.directory / "backups").mkdir(parents=True, exist_ok=True)
        self.settings = settings_path(payload).resolve()
        try:
            settings = read_json(self.settings)
        except (OSError, ValueError):
            settings = {}
        self.artists = db_path(payload, settings).resolve()
        self.index = resolve_path(payload.get("library_index") or DEFAULT_LIBRARY_INDEX, base_dir(payload)).resolve()
        self.annotations = annotation_path(self.index)
        self.dataset = hashlib.sha256(canonical([str(self.artists).casefold(), str(self.annotations).casefold()]).encode()).hexdigest()
        self.resources = [self.directory, self.artists, self.annotations, self.settings]
        self.baselines = {}
        self.prepared_categories = set()
        self.committing = False
        self.last_undo = None
        with data_lock(self.resources):
            self.store = RecoveryStore(self.directory)
            self.recover()
            self.epoch = self.store.meta("epoch")
        self.remember(self.settings, settings)

    def __enter__(self):
        self.token = ACTIVE.set(self)
        return self

    def __exit__(self, *_args):
        ACTIVE.reset(self.token)
        self.store.close()

    def remember(self, path, value):
        self.baselines[str(Path(path).resolve())] = json.loads(canonical(value))

    def check_cancel(self):
        from ..gui_api.runtime import CONTROL
        if not self.committing and CONTROL.is_cancelled():
            raise RuntimeError("Backup cancelled before commit")

    def progress(self, category):
        from ..events import PROGRESS_RECOVERY
        self.emit({"type": "progress", "key": PROGRESS_RECOVERY, "payload": {"category": category}})

    @contextmanager
    def guard(self):
        with data_lock(self.resources):
            if self.store.meta("epoch") != self.epoch:
                raise ValueError("Data was restored; refresh before applying an older task")
            yield

    @contextmanager
    def suspended(self):
        token = ACTIVE.set(None)
        try:
            yield
        finally:
            ACTIVE.reset(token)

    def before_write(self, category, count=1):
        if category in self.prepared_categories:
            return
        self.prepared_categories.add(category)
        day_key = f"daily:{self.dataset}"
        day = datetime.now(timezone.utc).date().isoformat()
        with self.suspended():
            if self.store.meta(day_key) != day:
                try:
                    create_archive(self, "daily", "daily")
                    self.store.connection.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", (day_key, day))
                    self.store.notice(self.dataset, "")
                except (OSError, ValueError) as exc:
                    self.store.notice(self.dataset, f"Daily backup failed: {exc}")
            if count > 1 or self.command in CHECKPOINTS or self.payload.get("reset_settings"):
                create_archive(self, "checkpoint", self.command, [category])

    def json_write(self, path, value, writer):
        path = Path(path).resolve()
        category = "artists" if path == self.artists else "settings" if path == self.settings else None
        with self.guard():
            if not category:
                return writer()
            before = read_json(path)
            if category == "artists":
                before, value = artist_data(before), artist_data(value)
            baseline = self.baselines.get(str(path), before)
            deltas = changes(baseline, value)
            if not deltas:
                return
            after = apply_deltas(before, deltas)
            self.before_write(category, len({d["path"][1] for d in deltas if len(d["path"]) > 1 and d["path"][0] == "artists"}) or 1)
            undoable = category == "artists" and self.command in UNDO_ARTISTS
            if self.command == "artists.rename":
                ids = {str(self.payload.get("old_id")), str(self.payload.get("new_id"))}
                deltas = [{"path": ["artists", key], "before": before["artists"].get(key), "after": after["artists"].get(key),
                           "had_before": key in before["artists"], "had_after": key in after["artists"]} for key in ids
                          if before["artists"].get(key) != after["artists"].get(key)]
            body = {"writes": [{"kind": "json", "path": str(path), "before": before, "after": after}],
                    "deltas": deltas, "count": len({item["path"][1] for item in deltas if len(item["path"]) > 1}) or 1,
                    "show_history": self.command in CHECKPOINTS or bool(self.payload.get("reset_settings"))}
            self.commit(category, body, undoable)
            self.remember(path, after)

    def commit(self, category, body, undoable=False):
        from .transactions import apply_writes
        identity = self.store.prepare(self.dataset, self.command, category, body, undoable)
        self.committing = True
        try:
            with self.suspended():
                apply_writes(body["writes"])
            self.finish(identity, body)
        except Exception:
            # A normal error rolls back; process death leaves a prepared intent
            # which is safely completed at the next startup.
            with self.suspended():
                apply_writes(body["writes"], reverse=True)
            self.store.connection.execute("UPDATE operations SET state='failed' WHERE id=?", (identity,))
            raise
        finally:
            self.committing = False
        if undoable:
            self.last_undo = identity
        return identity

    def finish(self, identity, body):
        self.store.connection.execute("BEGIN IMMEDIATE")
        try:
            self._finish(identity, body)
            self.store.connection.execute("COMMIT")
        except BaseException:
            self.store.connection.execute("ROLLBACK")
            raise
        self.epoch = self.store.meta("epoch")

    def _finish(self, identity, body):
        for category in body.get("invalidate", []):
            self.store.connection.execute("UPDATE operations SET state='invalidated' WHERE dataset=? AND category=? AND state='committed' AND undoable=1",
                                          (self.dataset, category))
        if body.get("undo_id"):
            self.store.connection.execute("UPDATE operations SET state='undone' WHERE id=?", (body["undo_id"],))
        if body.get("invalidate"):
            self.store.bump()
        self.store.finish(identity)

    def recover(self):
        from .transactions import apply_writes
        for row in self.store.connection.execute("SELECT id,dataset,body FROM operations WHERE state='prepared' ORDER BY rowid").fetchall():
            body = json.loads(row["body"])
            with data_lock([write["path"] for write in body["writes"]]), self.suspended():
                apply_writes(body["writes"])
            dataset = self.dataset
            self.dataset = row["dataset"]
            self.finish(row["id"], body)
            self.dataset = dataset

    def annotation_write(self, store, updates):
        with self.guard():
            records = []
            for identity, before, after in updates:
                if before != after:
                    records.append({"id": identity, "before": before, "after": after})
            if not records:
                return
            self.before_write("annotations", len(records))
            self.commit("annotations", {"writes": [{"kind": "annotations", "path": str(store.path), "records": records}],
                                        "count": len(records)}, True)
