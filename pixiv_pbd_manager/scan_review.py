"""Durable, dataset-scoped folder evidence. Never infer evidence from a UI cache."""

from contextlib import contextmanager, nullcontext
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time

from .recovery import ACTIVE
from .recovery.policy import canonical
from .scanner import MEDIA_SUFFIXES, extract_work_ids, is_relative_to


def snapshot(folder, excludes=(), max_depth=None):
    root = Path(folder).resolve()
    excluded = [Path(path).resolve() for path in excludes]
    files, errors, samples = [], [], {}
    if not root.is_dir():
        return {"fingerprint": "", "unavailable": True, "samples": {}, "count": 0}
    for directory, dirs, names in os.walk(root, onerror=lambda exc: errors.append(str(exc)), followlinks=False):
        parent = Path(directory)
        dirs[:] = sorted(name for name in dirs if not (parent / name).is_symlink()
                         and is_relative_to((parent / name).resolve(), root)
                         and not any(is_relative_to((parent / name).resolve(), ex) for ex in excluded))
        if max_depth is not None and len(parent.relative_to(root).parts) >= max_depth:
            dirs[:] = []
        for name in sorted(names):
            path = parent / name
            if path.suffix.lower() not in MEDIA_SUFFIXES or path.is_symlink():
                continue
            try:
                stat = path.stat()
                files.append([str(path.relative_to(root)), stat.st_size, stat.st_mtime_ns])
                for pid in extract_work_ids(path):
                    samples.setdefault(pid, str(path))
            except OSError as exc:
                errors.append(str(exc))
    count = min(5, len(files))
    positions = [round(index * (len(files) - 1) / max(1, count - 1)) for index in range(count)]
    return {"fingerprint": hashlib.sha256(canonical(files).encode()).hexdigest(),
            "unavailable": bool(errors), "samples": samples, "count": len(files),
            "sample_paths": [str(root / files[index][0]) for index in positions]}


def database_signature(path):
    path = Path(path)
    return hashlib.sha256(path.read_bytes() if path.exists() else b"").hexdigest()


def status_for(item):
    ids = {candidate["artist_id"] for candidate in item.get("candidates", [])}
    if len(ids) > 1 or item.get("conflict"):
        return "conflict"
    if ids:
        return "awaiting_confirmation"
    if item.get("error") or any(query["status"] == "failed" for query in item.get("queries", [])):
        return "query_failed"
    return "pending" if item.get("samples") or item.get("name_hint") or item.get("unverified") else "no_clues"


class ReviewStore:
    def __init__(self, directory, dataset):
        self.dataset = dataset
        self.path = Path(directory) / "scan_review.sqlite3"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(self.path), timeout=30)
        self.db.execute("CREATE TABLE IF NOT EXISTS folders (dataset TEXT, path TEXT, body TEXT NOT NULL, PRIMARY KEY(dataset,path))")

    def close(self):
        self.db.close()

    def get(self, path):
        row = self.db.execute("SELECT body FROM folders WHERE dataset=? AND path=?", (self.dataset, str(Path(path).resolve()))).fetchone()
        if not row:
            raise ValueError("Review item no longer exists; refresh the list")
        return json.loads(row[0])

    def rows(self):
        return [json.loads(row[0]) for row in self.db.execute("SELECT body FROM folders WHERE dataset=? ORDER BY path", (self.dataset,))]

    def save(self, item, expected=None, *, keep_marks=False):
        session = ACTIVE.get()
        with session.guard() if session else nullcontext():
            with self.db:
                self.db.execute("BEGIN IMMEDIATE")
                if expected is not None:
                    stored = self.get(item["path"])
                    if stored.get("revision") != expected:
                        if not keep_marks:
                            raise ValueError("Review changed; refresh before retrying")
                        # A sync marked the folder while this query ran; that mark
                        # is newer than the query's snapshot, so it survives.
                        item = {**item, "stale": item.get("stale") or stored.get("stale", False),
                                "unavailable": item.get("unavailable") or stored.get("unavailable", False)}
                item = {**item, "revision": str(time.time_ns()), "updated_at": time.time(), "status": status_for(item)}
                self.db.execute("INSERT OR REPLACE INTO folders VALUES (?,?,?)", (self.dataset, item["path"], canonical(item)))
        return item

    def discard_assigned(self, db, excludes):
        from .operations._shared import known_save_roots, is_under_known_save_root
        roots = known_save_roots(db) + [Path(path).resolve() for path in excludes]
        with self.db:
            for item in self.rows():
                if is_under_known_save_root(Path(item["path"]), roots):
                    self.db.execute("DELETE FROM folders WHERE dataset=? AND path=?", (self.dataset, item["path"]))

    def discard_gone(self):
        """Drop rows for folders renamed or deleted inside a reachable parent; an
        unreachable parent may be an offline drive, so its rows stay."""
        with self.db:
            for item in self.rows():
                folder = Path(item["path"])
                if not folder.exists() and folder.parent.is_dir():
                    self.db.execute("DELETE FROM folders WHERE dataset=? AND path=?", (self.dataset, item["path"]))

    def mark_stale(self, paths, unavailable=()):
        """Mark rows whose folder contains, or lies inside, a changed path. Sync
        calls this while holding the commit lock, so it is set lookups and one
        transaction rather than a rows x paths scan with a save per row."""
        def related(values):
            exact = {os.path.normcase(str(Path(value))) for value in values}
            enclosing = {os.path.normcase(str(parent)) for value in values for parent in Path(value).parents}
            return lambda folder: os.path.normcase(str(folder)) in enclosing or any(
                os.path.normcase(str(parent)) in exact for parent in (folder, *folder.parents))
        changed, offline = related(paths), related(unavailable)
        marks = {}
        for item in self.rows():
            folder = Path(item["path"])
            unreachable = offline(folder)
            if unreachable or changed(folder):
                marks[item["path"]] = unreachable or not folder.is_dir()
        if not marks:
            return
        session = ACTIVE.get()
        with session.guard() if session else nullcontext():
            with self.db:
                self.db.execute("BEGIN IMMEDIATE")
                for path, unreachable in marks.items():
                    row = self.db.execute("SELECT body FROM folders WHERE dataset=? AND path=?", (self.dataset, path)).fetchone()
                    if row:
                        item = {**json.loads(row[0]), "stale": True, "unavailable": unreachable}
                        item = {**item, "revision": str(time.time_ns()), "updated_at": time.time(), "status": status_for(item)}
                        self.db.execute("INSERT OR REPLACE INTO folders VALUES (?,?,?)", (self.dataset, path, canonical(item)))


@contextmanager
def open_reviews(payload, settings):
    from .gui_api.payload import base_dir, db_path
    from .paths import DATA_DIR
    session = ACTIVE.get()
    dataset = session.dataset if session else hashlib.sha256(str(db_path(payload, settings).resolve()).encode()).hexdigest()
    store = ReviewStore(base_dir(payload) / DATA_DIR, dataset)
    try:
        yield store
    finally:
        store.close()
