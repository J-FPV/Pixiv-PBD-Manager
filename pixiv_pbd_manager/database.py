from __future__ import annotations

import json
from pathlib import Path

from .models import ArtistRecord
from .paths import DEFAULT_DB  # re-exported for callers that import it from here


class ArtistDatabase:
    def __init__(self, path: Path):
        self.path = path
        self.artists: dict[str, ArtistRecord] = {}

    @classmethod
    def load(cls, path: Path | str | None = None) -> "ArtistDatabase":
        db = cls(Path(path or DEFAULT_DB))
        if not db.path.exists():
            return db
        raw = json.loads(db.path.read_text(encoding="utf-8"))
        for artist_id, artist in (raw.get("artists") or {}).items():
            record = ArtistRecord.from_json({**artist, "id": str(artist.get("id") or artist_id)})
            db.artists[record.id] = record
        return db

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": 1,
            "artists": {
                artist_id: self.artists[artist_id].to_json()
                for artist_id in sorted(self.artists, key=lambda value: (len(value), value))
            },
        }
        self.path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

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
