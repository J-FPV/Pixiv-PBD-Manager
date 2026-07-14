"""Local health checks for the image library and its persisted paths."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .database import ArtistDatabase


def _resolved(path: Path | str) -> Path:
    return Path(path).expanduser().resolve()


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _writable_target(path: Path) -> bool:
    candidate = path if path.exists() else path.parent
    while not candidate.exists() and candidate != candidate.parent:
        candidate = candidate.parent
    return candidate.is_dir() and os.access(candidate, os.W_OK)


def _check_database(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"id": "database", "status": "warning", "code": "database_missing", "path": str(path)}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict) or not isinstance(raw.get("artists", {}), dict):
            raise ValueError("artists.json does not contain an artists object")
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        return {
            "id": "database",
            "status": "error",
            "code": "database_invalid",
            "path": str(path),
            "detail": str(exc),
        }
    return {
        "id": "database",
        "status": "ok",
        "code": "database_ok",
        "path": str(path),
        "count": len(raw.get("artists") or {}),
    }


def _check_save_paths(db: ArtistDatabase) -> tuple[dict[str, Any], dict[str, Any]]:
    registered: list[tuple[str, str, Path]] = []
    missing: list[str] = []
    for artist in db.artists.values():
        for raw_path in artist.save_paths:
            try:
                path = _resolved(raw_path)
            except (OSError, RuntimeError):
                missing.append(f"{artist.name or artist.id} ({artist.id}): {raw_path}")
                continue
            registered.append((artist.id, artist.name or artist.id, path))
            if not path.is_dir():
                missing.append(f"{artist.name or artist.id} ({artist.id}): {path}")

    save_check = {
        "id": "save_paths",
        "status": "warning" if missing else "ok",
        "code": "save_paths_missing" if missing else "save_paths_ok",
        "count": len(missing) if missing else len(registered),
        "paths": missing[:30],
    }

    overlaps: list[str] = []
    for index, (left_id, left_name, left) in enumerate(registered):
        for right_id, right_name, right in registered[index + 1 :]:
            if left_id == right_id:
                continue
            if left == right or _is_within(left, right) or _is_within(right, left):
                overlaps.append(f"{left_name} ({left_id}): {left}  <->  {right_name} ({right_id}): {right}")
    overlap_check = {
        "id": "path_overlap",
        "status": "warning" if overlaps else "ok",
        "code": "path_overlap_found" if overlaps else "path_overlap_ok",
        "count": len(overlaps),
        "paths": overlaps[:30],
    }
    return save_check, overlap_check


def _check_browser(user_data_dir: str, download_roots: list[Path]) -> dict[str, Any]:
    if not user_data_dir:
        return {"id": "browser_data", "status": "ok", "code": "browser_data_default"}
    try:
        target = _resolved(user_data_dir)
        unsafe = any(target == root or _is_within(target, root) for root in download_roots)
    except (OSError, RuntimeError) as exc:
        return {"id": "browser_data", "status": "error", "code": "browser_data_invalid", "detail": str(exc)}
    return {
        "id": "browser_data",
        "status": "error" if unsafe else "ok",
        "code": "browser_data_unsafe" if unsafe else "browser_data_ok",
        "path": str(target),
    }


def _check_quarantine(quarantine_dir: str, protected_roots: list[Path]) -> dict[str, Any]:
    if not quarantine_dir:
        return {"id": "quarantine", "status": "warning", "code": "quarantine_missing"}
    try:
        target = _resolved(quarantine_dir)
        unsafe = any(target == root or _is_within(target, root) for root in protected_roots)
    except (OSError, RuntimeError) as exc:
        return {"id": "quarantine", "status": "error", "code": "quarantine_invalid", "detail": str(exc)}
    if unsafe:
        code, status = "quarantine_unsafe", "error"
    elif not _writable_target(target):
        code, status = "quarantine_not_writable", "error"
    else:
        code, status = "quarantine_ok", "ok"
    return {"id": "quarantine", "status": status, "code": code, "path": str(target)}


def _check_index(status: dict[str, Any]) -> dict[str, Any]:
    if not status.get("index_exists"):
        code, level = "index_missing", "warning"
    elif status.get("stale"):
        code, level = "index_stale", "warning"
    else:
        code, level = "index_ok", "ok"
    return {
        "id": "library_index",
        "status": level,
        "code": code,
        "count": int(status.get("entry_count") or 0),
        "age_seconds": int(status.get("age_seconds") or 0),
        "reasons": list(status.get("reasons") or []),
        "path": str(status.get("metadata_path") or ""),
    }


def run_library_doctor(
    *,
    database_path: Path,
    download_roots: list[Path],
    user_data_dir: str = "",
    quarantine_dir: str = "",
    index_status: dict[str, Any],
) -> dict[str, Any]:
    resolved_roots: list[Path] = []
    for root in download_roots:
        try:
            resolved_roots.append(_resolved(root))
        except (OSError, RuntimeError):
            continue
    db_check = _check_database(database_path)
    # A diagnostic command must remain usable when the file it diagnoses is
    # malformed, non-UTF-8, or has the wrong JSON shape.
    db = ArtistDatabase.load(database_path) if db_check["status"] != "error" else ArtistDatabase(database_path)
    save_check, overlap_check = _check_save_paths(db)
    checks = [
        db_check,
        save_check,
        overlap_check,
        _check_browser(user_data_dir, resolved_roots),
        _check_quarantine(quarantine_dir, resolved_roots),
        _check_index(index_status),
    ]
    return {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "summary": {
            "ok": sum(check["status"] == "ok" for check in checks),
            "warnings": sum(check["status"] == "warning" for check in checks),
            "errors": sum(check["status"] == "error" for check in checks),
        },
        "checks": checks,
    }


__all__ = ["run_library_doctor"]
