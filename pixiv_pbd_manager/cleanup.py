"""Safe duplicate cleanup with a user-selected quarantine directory."""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

from .events import PROGRESS_CLEANUP_DONE, PROGRESS_CLEANUP_ITEM, PROGRESS_CLEANUP_START
from .paths import DEFAULT_CLEANUP_STATE, write_json_atomic
from .similar import ImageFingerprint, load_image_index, save_image_index, sha256_file


ProgressCallback = Callable[[str, dict[str, object]], None]
CancelCallback = Callable[[], bool]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class CleanupItem:
    id: str
    original_path: str
    quarantine_path: str
    sha256: str
    size_bytes: int
    mtime_ns: int
    width: int
    height: int
    phash: str
    dhash: str
    status: str = "pending"
    error: str = ""
    moved_at: str | None = None
    restored_at: str | None = None
    deleted_at: str | None = None

    @classmethod
    def from_json(cls, raw: dict[str, Any]) -> "CleanupItem":
        return cls(
            id=str(raw.get("id") or uuid4().hex),
            original_path=str(raw.get("original_path") or ""),
            quarantine_path=str(raw.get("quarantine_path") or ""),
            sha256=str(raw.get("sha256") or ""),
            size_bytes=int(raw.get("size_bytes") or 0),
            mtime_ns=int(raw.get("mtime_ns") or 0),
            width=int(raw.get("width") or 0),
            height=int(raw.get("height") or 0),
            phash=str(raw.get("phash") or ""),
            dhash=str(raw.get("dhash") or ""),
            status=str(raw.get("status") or "pending"),
            error=str(raw.get("error") or ""),
            moved_at=raw.get("moved_at"),
            restored_at=raw.get("restored_at"),
            deleted_at=raw.get("deleted_at"),
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "original_path": self.original_path,
            "quarantine_path": self.quarantine_path,
            "sha256": self.sha256,
            "size_bytes": self.size_bytes,
            "mtime_ns": self.mtime_ns,
            "width": self.width,
            "height": self.height,
            "phash": self.phash,
            "dhash": self.dhash,
            "status": self.status,
            "error": self.error,
            "moved_at": self.moved_at,
            "restored_at": self.restored_at,
            "deleted_at": self.deleted_at,
        }


@dataclass
class CleanupOperation:
    id: str
    created_at: str
    updated_at: str
    quarantine_root: str
    manifest_path: str
    status: str
    items: list[CleanupItem]

    @classmethod
    def from_json(cls, raw: dict[str, Any]) -> "CleanupOperation":
        return cls(
            id=str(raw.get("id") or ""),
            created_at=str(raw.get("created_at") or ""),
            updated_at=str(raw.get("updated_at") or ""),
            quarantine_root=str(raw.get("quarantine_root") or ""),
            manifest_path=str(raw.get("manifest_path") or ""),
            status=str(raw.get("status") or "partial"),
            items=[CleanupItem.from_json(item) for item in raw.get("items") or [] if isinstance(item, dict)],
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "quarantine_root": self.quarantine_root,
            "manifest_path": self.manifest_path,
            "status": self.status,
            "items": [item.to_json() for item in self.items],
        }


@dataclass
class IgnoredGroup:
    signature: str
    kind: str
    entry_count: int
    ignored_at: str

    def to_json(self) -> dict[str, Any]:
        return {
            "signature": self.signature,
            "kind": self.kind,
            "entry_count": self.entry_count,
            "ignored_at": self.ignored_at,
        }


def _empty_state() -> dict[str, Any]:
    return {"version": 1, "ignored_groups": {}, "operations": []}


def load_cleanup_state(path: Path = DEFAULT_CLEANUP_STATE) -> dict[str, Any]:
    if not path.exists():
        return _empty_state()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _empty_state()
    if not isinstance(raw, dict):
        return _empty_state()
    raw.setdefault("version", 1)
    raw.setdefault("ignored_groups", {})
    raw.setdefault("operations", [])
    return raw


def save_cleanup_state(state: dict[str, Any], path: Path = DEFAULT_CLEANUP_STATE) -> None:
    write_json_atomic(path, state)


def _emit(callback: ProgressCallback | None, key: str, **payload: object) -> None:
    if callback:
        callback(key, payload)


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def validate_quarantine_root(quarantine_root: Path, protected_roots: list[Path]) -> Path:
    target = quarantine_root.expanduser().resolve()
    for root in protected_roots:
        protected = root.expanduser().resolve()
        if target == protected or _is_within(target, protected):
            raise ValueError(f"Quarantine folder cannot be inside a scan or download folder: {protected}")
    return target


def _operation_status(operation: CleanupOperation) -> str:
    statuses = {item.status for item in operation.items}
    if statuses <= {"quarantined", "restored", "deleted"}:
        return "complete"
    if statuses & {"quarantined", "restored", "deleted"}:
        return "partial"
    return "failed"


def _persist_operation(state_path: Path, state: dict[str, Any], operation: CleanupOperation) -> None:
    operation.updated_at = _utc_now()
    operation.status = _operation_status(operation)
    manifest_path = Path(operation.manifest_path)
    write_json_atomic(manifest_path, {"version": 1, "operation": operation.to_json()})
    operations = state.setdefault("operations", [])
    replacement = operation.to_json()
    for index, raw in enumerate(operations):
        if isinstance(raw, dict) and raw.get("id") == operation.id:
            operations[index] = replacement
            break
    else:
        operations.append(replacement)
    save_cleanup_state(state, state_path)


def _reconcile_item(item: CleanupItem) -> bool:
    original = Path(item.original_path)
    quarantined = Path(item.quarantine_path)
    previous = item.status
    if item.status == "moving":
        if quarantined.is_file() and not original.exists():
            item.status = "quarantined"
            item.moved_at = item.moved_at or _utc_now()
            item.error = ""
        elif original.is_file() and not quarantined.exists():
            item.status = "error"
            item.error = "Cleanup was interrupted before this file was moved."
        else:
            item.status = "error"
            item.error = "Cleanup was interrupted and the file location is ambiguous."
    elif item.status == "restoring":
        if original.is_file() and not quarantined.exists():
            item.status = "restored"
            item.restored_at = item.restored_at or _utc_now()
            item.error = ""
        elif quarantined.is_file() and not original.exists():
            item.status = "quarantined"
            item.error = ""
        else:
            item.status = "error"
            item.error = "Restore was interrupted and the file location is ambiguous."
    elif item.status == "deleting":
        if quarantined.exists():
            item.status = "quarantined"
        else:
            item.status = "deleted"
            item.deleted_at = item.deleted_at or _utc_now()
        item.error = ""
    return item.status != previous


def _load_operations(state: dict[str, Any]) -> list[CleanupOperation]:
    return [
        CleanupOperation.from_json(raw)
        for raw in state.get("operations") or []
        if isinstance(raw, dict)
    ]


def cleanup_summary(state_path: Path = DEFAULT_CLEANUP_STATE) -> dict[str, Any]:
    state = load_cleanup_state(state_path)
    changed = False
    operations = _load_operations(state)
    for operation in operations:
        operation_changed = any(_reconcile_item(item) for item in operation.items)
        if operation_changed:
            _persist_operation(state_path, state, operation)
            changed = True
    if changed:
        state = load_cleanup_state(state_path)
        operations = _load_operations(state)
    ignored = [
        raw
        for raw in (state.get("ignored_groups") or {}).values()
        if isinstance(raw, dict)
    ]
    return {
        "state_path": str(state_path),
        "operations": [
            operation.to_json()
            for operation in sorted(operations, key=lambda item: item.created_at, reverse=True)
        ],
        "ignored_groups": sorted(ignored, key=lambda item: str(item.get("ignored_at") or ""), reverse=True),
    }


def _new_item(raw: dict[str, Any], destination: Path) -> CleanupItem:
    source = Path(str(raw.get("path") or "")).expanduser().resolve()
    return CleanupItem(
        id=uuid4().hex,
        original_path=str(source),
        quarantine_path=str(destination),
        sha256=str(raw.get("sha256") or ""),
        size_bytes=int(raw.get("size_bytes") or 0),
        mtime_ns=int(raw.get("mtime_ns") or 0),
        width=int(raw.get("width") or 0),
        height=int(raw.get("height") or 0),
        phash=str(raw.get("phash") or ""),
        dhash=str(raw.get("dhash") or ""),
    )


def _remove_index_paths(index_path: Path, moved_paths: set[str]) -> None:
    entries = load_image_index(index_path)
    if not entries:
        return
    save_image_index(
        [entry for path, entry in entries.items() if path not in moved_paths],
        index_path,
    )


def _restore_index_items(index_path: Path, items: list[CleanupItem]) -> None:
    entries = load_image_index(index_path)
    for item in items:
        path = Path(item.original_path)
        if not path.is_file() or not item.sha256 or not item.phash or not item.dhash:
            continue
        stat = path.stat()
        entries[str(path.resolve())] = ImageFingerprint(
            path=str(path.resolve()),
            size_bytes=stat.st_size,
            mtime_ns=stat.st_mtime_ns,
            width=item.width,
            height=item.height,
            sha256=item.sha256,
            phash=item.phash,
            dhash=item.dhash,
        )
    save_image_index(list(entries.values()), index_path)


def _copy_bytes_required(raw_items: list[dict[str, Any]], target_root: Path) -> int:
    target_device = target_root.stat().st_dev
    required = 0
    for raw in raw_items:
        source = Path(str(raw.get("path") or "")).expanduser().resolve()
        try:
            stat = source.stat()
        except OSError:
            continue
        if stat.st_dev != target_device:
            required += stat.st_size
    return required


def _ensure_copy_space(raw_items: list[dict[str, Any]], target_root: Path) -> None:
    required = _copy_bytes_required(raw_items, target_root)
    if required <= 0:
        return
    free = shutil.disk_usage(target_root).free
    if required > free:
        raise OSError(
            "Not enough free space in quarantine folder: "
            f"{required} bytes required, {free} bytes available"
        )


def quarantine_files(
    raw_items: list[dict[str, Any]],
    *,
    quarantine_root: Path,
    protected_roots: list[Path],
    state_path: Path = DEFAULT_CLEANUP_STATE,
    index_path: Path,
    progress_callback: ProgressCallback | None = None,
    should_cancel: CancelCallback | None = None,
) -> dict[str, Any]:
    if not raw_items:
        raise ValueError("Select at least one file to quarantine")
    root = validate_quarantine_root(quarantine_root, protected_roots)
    root.mkdir(parents=True, exist_ok=True)
    _ensure_copy_space(raw_items, root)
    operation_id = f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid4().hex[:8]}"
    task_dir = root / operation_id
    task_dir.mkdir(parents=False, exist_ok=False)
    items = [
        _new_item(raw, task_dir / f"{index:04d}_{Path(str(raw.get('path') or '')).name}")
        for index, raw in enumerate(raw_items, start=1)
    ]
    now = _utc_now()
    operation = CleanupOperation(
        id=operation_id,
        created_at=now,
        updated_at=now,
        quarantine_root=str(root),
        manifest_path=str(task_dir / "manifest.json"),
        status="partial",
        items=items,
    )
    state = load_cleanup_state(state_path)
    _persist_operation(state_path, state, operation)
    _emit(progress_callback, PROGRESS_CLEANUP_START, action="quarantine", total=len(items))

    moved_paths: set[str] = set()
    cancelled = False
    for position, item in enumerate(items, start=1):
        if should_cancel and should_cancel():
            cancelled = True
            for remaining in items[position - 1 :]:
                if remaining.status == "pending":
                    remaining.status = "cancelled"
            _persist_operation(state_path, state, operation)
            break
        source = Path(item.original_path)
        try:
            stat = source.stat()
            if not source.is_file():
                raise FileNotFoundError(f"File does not exist: {source}")
            if item.size_bytes and stat.st_size != item.size_bytes:
                raise ValueError(f"File changed after the scan: {source}")
            # mtime is a weak signal — backups, cloud sync, and metadata edits
            # drift it without changing the bytes. The size already matched, so
            # only treat an mtime change as "changed" when the content hash
            # actually differs (re-hash just this one file; cheap and rare).
            if item.mtime_ns and stat.st_mtime_ns != item.mtime_ns:
                if not item.sha256 or sha256_file(source) != item.sha256:
                    raise ValueError(f"File changed after the scan: {source}")
            item.status = "moving"
            item.error = ""
            _persist_operation(state_path, state, operation)
            shutil.move(str(source), str(item.quarantine_path))
            item.status = "quarantined"
            item.moved_at = _utc_now()
            moved_paths.add(item.original_path)
        except Exception as exc:  # noqa: BLE001 - per-file transaction boundary
            item.status = "error"
            item.error = str(exc)
        _persist_operation(state_path, state, operation)
        _emit(
            progress_callback,
            PROGRESS_CLEANUP_ITEM,
            action="quarantine",
            current=position,
            total=len(items),
            path=item.original_path,
            status=item.status,
        )

    _remove_index_paths(index_path, moved_paths)
    _persist_operation(state_path, state, operation)
    _emit(
        progress_callback,
        PROGRESS_CLEANUP_DONE,
        action="quarantine",
        total=len(items),
        succeeded=len(moved_paths),
        cancelled=cancelled,
    )
    result = cleanup_summary(state_path)
    result["operation_id"] = operation.id
    result["moved_paths"] = sorted(moved_paths)
    result["cancelled"] = cancelled
    return result


def _find_operation(state: dict[str, Any], operation_id: str) -> CleanupOperation:
    for operation in _load_operations(state):
        if operation.id == operation_id:
            return operation
    raise ValueError(f"Cleanup operation not found: {operation_id}")


def _selected_items(operation: CleanupOperation, item_ids: list[str], status: str) -> list[CleanupItem]:
    requested = set(item_ids)
    return [
        item
        for item in operation.items
        if item.status == status and (not requested or item.id in requested)
    ]


def restore_files(
    operation_id: str,
    *,
    item_ids: list[str] | None = None,
    state_path: Path = DEFAULT_CLEANUP_STATE,
    index_path: Path,
    progress_callback: ProgressCallback | None = None,
    should_cancel: CancelCallback | None = None,
) -> dict[str, Any]:
    state = load_cleanup_state(state_path)
    operation = _find_operation(state, operation_id)
    items = _selected_items(operation, item_ids or [], "quarantined")
    _emit(progress_callback, PROGRESS_CLEANUP_START, action="restore", total=len(items))
    restored: list[CleanupItem] = []
    cancelled = False
    for position, item in enumerate(items, start=1):
        if should_cancel and should_cancel():
            cancelled = True
            break
        source = Path(item.quarantine_path)
        destination = Path(item.original_path)
        try:
            if destination.exists():
                raise FileExistsError(f"Restore target already exists: {destination}")
            if not source.is_file():
                raise FileNotFoundError(f"Quarantined file does not exist: {source}")
            destination.parent.mkdir(parents=True, exist_ok=True)
            item.status = "restoring"
            item.error = ""
            _persist_operation(state_path, state, operation)
            shutil.move(str(source), str(destination))
            item.status = "restored"
            item.restored_at = _utc_now()
            restored.append(item)
        except Exception as exc:  # noqa: BLE001 - per-file transaction boundary
            item.status = "quarantined" if source.exists() else "error"
            item.error = str(exc)
        _persist_operation(state_path, state, operation)
        _emit(
            progress_callback,
            PROGRESS_CLEANUP_ITEM,
            action="restore",
            current=position,
            total=len(items),
            path=item.original_path,
            status=item.status,
        )
    _restore_index_items(index_path, restored)
    _emit(
        progress_callback,
        PROGRESS_CLEANUP_DONE,
        action="restore",
        total=len(items),
        succeeded=len(restored),
        cancelled=cancelled,
    )
    result = cleanup_summary(state_path)
    result["restored_paths"] = [item.original_path for item in restored]
    result["cancelled"] = cancelled
    return result


def delete_quarantined_files(
    operation_id: str,
    *,
    item_ids: list[str] | None = None,
    state_path: Path = DEFAULT_CLEANUP_STATE,
    progress_callback: ProgressCallback | None = None,
    should_cancel: CancelCallback | None = None,
) -> dict[str, Any]:
    state = load_cleanup_state(state_path)
    operation = _find_operation(state, operation_id)
    items = _selected_items(operation, item_ids or [], "quarantined")
    _emit(progress_callback, PROGRESS_CLEANUP_START, action="delete", total=len(items))
    deleted = 0
    cancelled = False
    for position, item in enumerate(items, start=1):
        if should_cancel and should_cancel():
            cancelled = True
            break
        source = Path(item.quarantine_path)
        try:
            if not source.is_file():
                raise FileNotFoundError(f"Quarantined file does not exist: {source}")
            item.status = "deleting"
            item.error = ""
            _persist_operation(state_path, state, operation)
            source.unlink()
            item.status = "deleted"
            item.deleted_at = _utc_now()
            deleted += 1
        except Exception as exc:  # noqa: BLE001 - per-file transaction boundary
            item.status = "quarantined" if source.exists() else "error"
            item.error = str(exc)
        _persist_operation(state_path, state, operation)
        _emit(
            progress_callback,
            PROGRESS_CLEANUP_ITEM,
            action="delete",
            current=position,
            total=len(items),
            path=item.quarantine_path,
            status=item.status,
        )
    _emit(
        progress_callback,
        PROGRESS_CLEANUP_DONE,
        action="delete",
        total=len(items),
        succeeded=deleted,
        cancelled=cancelled,
    )
    result = cleanup_summary(state_path)
    result["deleted"] = deleted
    result["cancelled"] = cancelled
    return result


def ignore_group(
    signature: str,
    *,
    kind: str,
    entry_count: int,
    state_path: Path = DEFAULT_CLEANUP_STATE,
) -> dict[str, Any]:
    if not signature:
        raise ValueError("Missing group signature")
    state = load_cleanup_state(state_path)
    ignored = IgnoredGroup(signature, kind, entry_count, _utc_now())
    state.setdefault("ignored_groups", {})[signature] = ignored.to_json()
    save_cleanup_state(state, state_path)
    return cleanup_summary(state_path)


def unignore_group(signature: str, *, state_path: Path = DEFAULT_CLEANUP_STATE) -> dict[str, Any]:
    state = load_cleanup_state(state_path)
    ignored = state.setdefault("ignored_groups", {})
    ignored.pop(signature, None)
    save_cleanup_state(state, state_path)
    return cleanup_summary(state_path)


__all__ = [
    "CleanupItem",
    "CleanupOperation",
    "IgnoredGroup",
    "cleanup_summary",
    "delete_quarantined_files",
    "ignore_group",
    "load_cleanup_state",
    "quarantine_files",
    "restore_files",
    "save_cleanup_state",
    "unignore_group",
    "validate_quarantine_root",
]
