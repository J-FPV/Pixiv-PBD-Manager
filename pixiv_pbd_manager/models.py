from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .text_safety import repair_surrogate_mojibake


def _safe_optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = repair_surrogate_mojibake(str(value))
    return text if text else None


def _safe_text(value: Any) -> str:
    return repair_surrogate_mojibake(str(value or ""))


def _safe_text_list(values: Any) -> list[str]:
    return [repair_surrogate_mojibake(str(item)) for item in values or []]


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@dataclass
class ArtistRecord:
    id: str
    name: str | None = None
    first_seen: str = field(default_factory=utc_now)
    last_seen: str = field(default_factory=utc_now)
    last_opened: str | None = None
    last_checked: str | None = None
    sources: list[str] = field(default_factory=list)
    download_roots: list[str] = field(default_factory=list)
    save_paths: list[str] = field(default_factory=list)
    work_ids: list[str] = field(default_factory=list)
    new_work_ids: list[str] = field(default_factory=list)
    notes: str = ""

    @classmethod
    def from_json(cls, raw: dict[str, Any]) -> "ArtistRecord":
        return cls(
            id=str(raw["id"]),
            name=_safe_optional_text(raw.get("name")),
            first_seen=_safe_text(raw.get("first_seen")) or utc_now(),
            last_seen=_safe_text(raw.get("last_seen")) or utc_now(),
            last_opened=_safe_optional_text(raw.get("last_opened")),
            last_checked=_safe_optional_text(raw.get("last_checked")),
            sources=_safe_text_list(raw.get("sources")),
            download_roots=_safe_text_list(raw.get("download_roots")),
            save_paths=_safe_text_list(raw.get("save_paths")),
            work_ids=sorted({str(item) for item in raw.get("work_ids") or []}),
            new_work_ids=sorted({str(item) for item in raw.get("new_work_ids") or []}),
            notes=_safe_text(raw.get("notes")),
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "first_seen": self.first_seen,
            "last_seen": self.last_seen,
            "last_opened": self.last_opened,
            "last_checked": self.last_checked,
            "sources": sorted(set(self.sources)),
            "download_roots": sorted(set(self.download_roots)),
            "save_paths": sorted(set(self.save_paths)),
            "work_ids": sorted(set(self.work_ids), key=lambda value: (len(value), value)),
            "new_work_ids": sorted(set(self.new_work_ids), key=lambda value: (len(value), value)),
            "notes": self.notes,
        }

    @property
    def pixiv_url(self) -> str:
        return f"https://www.pixiv.net/users/{self.id}/artworks"

    def merge(
        self,
        *,
        name: str | None = None,
        source: str | None = None,
        root: Path | str | None = None,
        save_path: Path | str | None = None,
        work_ids: set[str] | None = None,
    ) -> bool:
        changed = False
        if name and name != self.name:
            self.name = name
            changed = True
        if source and source not in self.sources:
            self.sources.append(source)
            changed = True
        if root:
            root_text = str(Path(root).resolve())
            if root_text not in self.download_roots:
                self.download_roots.append(root_text)
                changed = True
        if save_path:
            save_path_text = str(Path(save_path).resolve())
            if save_path_text not in self.save_paths:
                self.save_paths.append(save_path_text)
                changed = True
        if work_ids:
            before = set(self.work_ids)
            after = before | {str(item) for item in work_ids}
            if after != before:
                self.work_ids = sorted(after, key=lambda value: (len(value), value))
                changed = True
                self.new_work_ids = sorted(set(self.new_work_ids) - after, key=lambda value: (len(value), value))
        if changed:
            self.last_seen = utc_now()
        return changed

    def update_remote_work_ids(self, remote_work_ids: set[str]) -> bool:
        new_work_ids = sorted(
            {str(item) for item in remote_work_ids} - set(self.work_ids),
            key=lambda value: (len(value), value),
        )
        now = utc_now()
        changed = self.last_checked != now or set(new_work_ids) != set(self.new_work_ids)
        self.last_checked = now
        self.new_work_ids = new_work_ids
        return changed
