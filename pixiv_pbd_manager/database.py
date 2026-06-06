from __future__ import annotations

import json
from pathlib import Path

from collections.abc import Iterable

from .models import ArtistRecord
from .paths import DEFAULT_DB, write_json_atomic  # re-exported for callers that import them from here


def _dedupe(names: Iterable[str]) -> list[str]:
    """Drop duplicates while keeping first-seen order."""
    ordered: list[str] = []
    for name in names:
        if name not in ordered:
            ordered.append(name)
    return ordered


def _merge_tag_order(defined: object, records: Iterable[ArtistRecord]) -> list[str]:
    """Ordered, de-duplicated tag list: stored definitions first (creation order),
    then any tag found on an artist but not yet defined. Self-heals databases
    written before tags were tracked, and tolerates a missing/garbage ``tags``
    key in older files."""
    ordered: list[str] = []
    seen: set[str] = set()
    for name in defined if isinstance(defined, list) else []:
        text = str(name).strip()
        if text and text not in seen:
            ordered.append(text)
            seen.add(text)
    extra = {tag for record in records for tag in record.tags if tag not in seen}
    ordered.extend(sorted(extra))
    return ordered


class ArtistDatabase:
    def __init__(self, path: Path):
        self.path = path
        self.artists: dict[str, ArtistRecord] = {}
        self.defined_tags: list[str] = []

    @classmethod
    def load(cls, path: Path | str | None = None) -> "ArtistDatabase":
        db = cls(Path(path or DEFAULT_DB))
        if not db.path.exists():
            return db
        # Tolerate empty / corrupt artists.json files: an interrupted save (e.g.
        # the prior ``os error 206`` payload-too-long crash) can leave a zero-
        # byte or partially-written file. Without this guard, every subsequent
        # ``artists.list`` / ``scan.*`` / ``updates.*`` IPC bombs out with
        # ``Expecting value: line 1 column 1 (char 0)`` from json.loads, and
        # the user has no way to recover from inside the app. Treat broken
        # files as "empty DB" so the user can rescan to repopulate.
        try:
            text = db.path.read_text(encoding="utf-8")
        except OSError:
            return db
        if not text.strip():
            return db
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            return db
        if not isinstance(raw, dict):
            return db
        for artist_id, artist in (raw.get("artists") or {}).items():
            record = ArtistRecord.from_json({**artist, "id": str(artist.get("id") or artist_id)})
            db.artists[record.id] = record
        db.defined_tags = _merge_tag_order(raw.get("tags"), db.artists.values())
        return db

    def save(self) -> None:
        payload = {
            "version": 1,
            "tags": list(self.defined_tags),
            "artists": {
                artist_id: self.artists[artist_id].to_json()
                for artist_id in sorted(self.artists, key=lambda value: (len(value), value))
            },
        }
        write_json_atomic(self.path, payload)

    def upsert(
        self,
        artist_id: str,
        *,
        name: str | None = None,
        source: str | None = None,
        root: Path | str | None = None,
        save_path: Path | str | None = None,
        work_ids: set[str] | None = None,
    ) -> bool:
        artist_id = str(artist_id)
        existing = self.artists.get(artist_id)
        if existing:
            return existing.merge(name=name, source=source, root=root, save_path=save_path, work_ids=work_ids)

        record = ArtistRecord(id=artist_id, name=name)
        record.merge(source=source, root=root, save_path=save_path, work_ids=work_ids)
        self.artists[artist_id] = record
        return True

    def get_many(self, artist_ids: list[str] | None = None) -> list[ArtistRecord]:
        if artist_ids:
            missing = [artist_id for artist_id in artist_ids if artist_id not in self.artists]
            if missing:
                raise KeyError(f"Unknown artist id(s): {', '.join(missing)}")
            return [self.artists[artist_id] for artist_id in artist_ids]
        return [self.artists[artist_id] for artist_id in sorted(self.artists, key=lambda value: (len(value), value))]

    def remove_many(self, artist_ids: list[str]) -> list[str]:
        removed: list[str] = []
        for artist_id in artist_ids:
            artist_id = str(artist_id).strip()
            if artist_id and artist_id in self.artists:
                del self.artists[artist_id]
                removed.append(artist_id)
        return removed

    def rename_artist_id(self, old_id: str, new_id: str) -> bool:
        old_id = str(old_id).strip()
        new_id = str(new_id).strip()
        if not old_id or not new_id or old_id == new_id:
            return False
        if old_id not in self.artists:
            raise KeyError(f"Unknown artist id: {old_id}")
        if not new_id.isdigit():
            raise ValueError("Artist ID must contain only digits.")

        source = self.artists.pop(old_id)
        source.id = new_id
        edit_source = f"manual_id_edit:{old_id}->{new_id}"
        if edit_source not in source.sources:
            source.sources.append(edit_source)

        target = self.artists.get(new_id)
        if not target:
            self.artists[new_id] = source
            return True

        target.merge(name=target.name or source.name, source=edit_source)
        for item in source.sources:
            if item not in target.sources:
                target.sources.append(item)
        for item in source.download_roots:
            if item not in target.download_roots:
                target.download_roots.append(item)
        for item in source.save_paths:
            if item not in target.save_paths:
                target.save_paths.append(item)
        target.work_ids = sorted(set(target.work_ids) | set(source.work_ids), key=lambda value: (len(value), value))
        target.new_work_ids = sorted(set(target.new_work_ids) | set(source.new_work_ids), key=lambda value: (len(value), value))
        return True

    def set_artist_save_path(self, artist_id: str, save_path: Path | str) -> bool:
        artist_id = str(artist_id).strip()
        if artist_id not in self.artists:
            raise KeyError(f"Unknown artist id: {artist_id}")
        path_text = str(Path(save_path).resolve())
        record = self.artists[artist_id]
        if record.save_paths == [path_text]:
            return False
        record.save_paths = [path_text]
        source = f"manual_save_path:{path_text}"
        if source not in record.sources:
            record.sources.append(source)
        return True

    def set_artist_favorite(self, artist_id: str, favorite: bool) -> bool:
        artist_id = str(artist_id).strip()
        if artist_id not in self.artists:
            raise KeyError(f"Unknown artist id: {artist_id}")
        record = self.artists[artist_id]
        favorite = bool(favorite)
        if record.favorite == favorite:
            return False
        record.favorite = favorite
        return True

    def set_artist_tags(self, artist_id: str, tags: list[str]) -> bool:
        artist_id = str(artist_id).strip()
        if artist_id not in self.artists:
            raise KeyError(f"Unknown artist id: {artist_id}")
        record = self.artists[artist_id]
        cleaned = sorted({str(tag).strip() for tag in tags or [] if str(tag).strip()})
        tags_changed = sorted(set(record.tags)) != cleaned
        if tags_changed:
            record.tags = cleaned
        defs_changed = self._ensure_tags(cleaned)
        return tags_changed or defs_changed

    def _ensure_tags(self, names: Iterable[str]) -> bool:
        """Register tag names in the ordered definition list; return True if any
        were newly added."""
        changed = False
        for name in names:
            text = str(name).strip()
            if text and text not in self.defined_tags:
                self.defined_tags.append(text)
                changed = True
        return changed

    def add_tag(self, name: str) -> bool:
        name = str(name).strip()
        if not name:
            raise ValueError("Tag name is empty")
        return self._ensure_tags([name])

    def assign_tag(self, artist_ids: list[str], name: str) -> int:
        """Add ``name`` to each given artist; return how many gained it."""
        name = str(name).strip()
        if not name:
            raise ValueError("Tag name is empty")
        self._ensure_tags([name])
        assigned = 0
        for artist_id in artist_ids:
            record = self.artists.get(str(artist_id).strip())
            if record and name not in record.tags:
                record.tags = sorted({*record.tags, name})
                assigned += 1
        return assigned

    def rename_tag(self, old: str, new: str) -> bool:
        old = str(old).strip()
        new = str(new).strip()
        if not new:
            raise ValueError("Tag name is empty")
        if old == new:
            return False
        changed = self._ensure_tags([new])
        if old in self.defined_tags:
            self.defined_tags = _dedupe([new if tag == old else tag for tag in self.defined_tags])
            changed = True
        for record in self.artists.values():
            if old in record.tags:
                record.tags = sorted({new if tag == old else tag for tag in record.tags})
                changed = True
        return changed

    def delete_tag(self, name: str) -> bool:
        name = str(name).strip()
        changed = False
        if name in self.defined_tags:
            self.defined_tags = [tag for tag in self.defined_tags if tag != name]
            changed = True
        for record in self.artists.values():
            if name in record.tags:
                record.tags = [tag for tag in record.tags if tag != name]
                changed = True
        return changed
