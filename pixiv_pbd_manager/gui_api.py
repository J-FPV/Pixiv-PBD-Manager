from __future__ import annotations

import base64
from io import BytesIO
import json
import os
import subprocess
import sys
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Callable

from .browser import open_urls
from .consent import is_cookie_consent_recorded, record_cookie_consent, revoke_cookie_consent
from .cookie_store import clear_cookie, load_cookie, save_cookie, storage_label
from .database import DEFAULT_DB, ArtistDatabase
from .models import ArtistRecord
from .operations import (
    DownloadUpdatesResult,
    ScanResult,
    UpdateCheckResult,
    apply_scan_changes,
    check_artist_updates,
    collect_local_work_ids,
    download_artist_updates,
    preview_scan_changes,
    scan_into_database,
)
from .resolver import PixivResolveError, fetch_user_profile
from .scanner import is_relative_to
from .similar import SimilarGroup, SimilarImageResult, find_similar_images


DEFAULT_SETTINGS = Path(".pixiv-pbd-manager") / "gui_settings.json"
SOURCE_ROOT = Path(__file__).resolve().parents[1]
JsonDict = dict[str, Any]
Emitter = Callable[[JsonDict], None]


class TaskControl:
    """Process-wide pause gate driven by stdin control messages.

    The frontend writes ``{"control":"pause"}`` / ``{"control":"resume"}`` lines
    to the subprocess stdin; a reader thread toggles this gate. Long-running
    loops block on it at progress checkpoints so a paused task stops issuing new
    work without holding open downloads.
    """

    def __init__(self) -> None:
        self._resume = threading.Event()
        self._resume.set()

    def pause(self) -> None:
        self._resume.clear()

    def resume(self) -> None:
        self._resume.set()

    def wait_if_paused(self) -> None:
        self._resume.wait()


_CONTROL = TaskControl()
_EMIT_LOCK = threading.Lock()


def _load_json(path: Path) -> JsonDict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _save_json(path: Path, data: JsonDict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _looks_like_project_root(path: Path) -> bool:
    return (path / "pixiv_pbd_manager").is_dir() or (path / ".pixiv-pbd-manager").exists()


def _nearest_project_root(path: Path) -> Path | None:
    resolved = path.expanduser().resolve()
    for candidate in (resolved, *resolved.parents):
        if _looks_like_project_root(candidate):
            return candidate
    return None


def _resolve_base_dir(project_root: Any = None) -> Path:
    if not project_root:
        cwd = Path.cwd().resolve()
        return _nearest_project_root(cwd) or cwd

    raw = Path(str(project_root)).expanduser()
    candidates = [raw if raw.is_absolute() else Path.cwd() / raw, Path.cwd(), SOURCE_ROOT]

    for candidate in candidates:
        root = _nearest_project_root(candidate)
        if root:
            return root
    return SOURCE_ROOT


def _base_dir(payload: JsonDict) -> Path:
    return Path(str(payload.get("_base_dir") or Path.cwd())).expanduser().resolve()


def _resolve_path(path: Path | str, base_dir: Path) -> Path:
    value = Path(path).expanduser()
    return value if value.is_absolute() else base_dir / value


def _settings_path(payload: JsonDict) -> Path:
    return _resolve_path(payload.get("settings_path") or DEFAULT_SETTINGS, _base_dir(payload))


def _db_path(payload: JsonDict, settings: JsonDict | None = None) -> Path:
    value = payload.get("db_path") or payload.get("database") or (settings or {}).get("database") or DEFAULT_DB
    return _resolve_path(value, _base_dir(payload))


def _paths(values: Any, base_dir: Path | None = None) -> list[Path]:
    base = base_dir or Path.cwd()
    return [_resolve_path(str(value), base) for value in (values or []) if str(value).strip()]


def _bool(payload: JsonDict, key: str, default: bool) -> bool:
    value = payload.get(key)
    return default if value is None else bool(value)


def _float(payload: JsonDict, key: str, default: float) -> float:
    try:
        return float(payload.get(key, default))
    except (TypeError, ValueError):
        return default


def _int(payload: JsonDict, key: str, default: int) -> int:
    try:
        return int(payload.get(key, default))
    except (TypeError, ValueError):
        return default


def _artist_to_json(artist: ArtistRecord) -> JsonDict:
    return {
        "id": artist.id,
        "name": artist.name or "",
        "pixiv_url": artist.pixiv_url,
        "works": len(artist.work_ids),
        "new_works": len(artist.new_work_ids),
        "work_ids": list(artist.work_ids),
        "new_work_ids": list(artist.new_work_ids),
        "save_paths": list(artist.save_paths),
        "download_roots": list(artist.download_roots),
        "last_seen": artist.last_seen,
        "last_checked": artist.last_checked,
        "last_opened": artist.last_opened or "",
        "notes": artist.notes,
    }


def _scan_result_to_json(result: ScanResult) -> JsonDict:
    summary = result.summary
    unmatched = sorted(summary.unmatched_folders.items(), key=lambda item: (-item[1], item[0]))
    return {
        "files_seen": summary.files_seen,
        "files_matched": summary.files_matched,
        "excluded_dirs": summary.excluded_dirs,
        "artists": len(summary.artists),
        "name_only_artists": len(summary.name_only_artists),
        "changed": result.changed,
        "resolved_name_only": result.resolved_name_only,
        "fuzzy_resolved_name_only": result.fuzzy_resolved_name_only,
        "ssl_fallback_used": result.ssl_fallback_used,
        "resolve_errors": list(result.resolve_errors),
        "db_path": str(result.db_path),
        "unmatched_folders": [{"path": path, "count": count} for path, count in unmatched],
    }


def _update_result_to_json(result: UpdateCheckResult) -> JsonDict:
    return {
        "checked": result.checked,
        "artists_with_updates": result.artists_with_updates,
        "new_works": result.new_works,
        "ssl_fallback_used": result.ssl_fallback_used,
        "errors": list(result.errors),
    }


def _download_result_to_json(result: DownloadUpdatesResult) -> JsonDict:
    return {
        "artists": result.artists,
        "artworks": result.artworks,
        "pages_saved": result.pages_saved,
        "files_skipped": result.files_skipped,
        "ssl_fallback_used": result.ssl_fallback_used,
        "errors": list(result.errors),
    }


def _similar_group_to_json(group: SimilarGroup) -> JsonDict:
    return {
        "id": group.id,
        "kind": group.kind,
        "best_phash_distance": group.best_phash_distance,
        "best_dhash_distance": group.best_dhash_distance,
        "entries": [
            {
                "path": entry.path,
                "size_bytes": entry.size_bytes,
                "mtime_ns": entry.mtime_ns,
                "width": entry.width,
                "height": entry.height,
                "resolution": entry.resolution,
                "sha256": entry.sha256,
                "phash": entry.phash,
                "dhash": entry.dhash,
            }
            for entry in group.entries
        ],
    }


def _similar_result_to_json(result: SimilarImageResult) -> JsonDict:
    return {
        "roots": result.roots,
        "index_path": str(result.index_path),
        "files_seen": result.files_seen,
        "indexed": result.indexed,
        "reused": result.reused,
        "changed": result.changed,
        "error_count": result.error_count,
        "errors": list(result.errors),
        "groups": [_similar_group_to_json(group) for group in result.groups],
    }


def _image_thumbnail(path: Path, max_size: int) -> tuple[str, int, int]:
    from PIL import Image, ImageOps

    with Image.open(path) as image:
        try:
            image.seek(0)
        except EOFError:
            pass
        image = ImageOps.exif_transpose(image)
        width, height = image.size
        image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

        output = BytesIO()
        if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
            image.convert("RGBA").save(output, format="PNG", optimize=True)
            mime = "image/png"
        else:
            image.convert("RGB").save(output, format="JPEG", quality=84, optimize=True)
            mime = "image/jpeg"

    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return f"data:{mime};base64,{encoded}", width, height


def _emit(event: JsonDict) -> None:
    line = json.dumps(event, ensure_ascii=False) + "\n"
    data = line.encode("utf-8")
    with _EMIT_LOCK:
        buffer = getattr(sys.stdout, "buffer", None)
        if buffer is not None:
            buffer.write(data)
            buffer.flush()
        else:
            sys.stdout.write(line)
            sys.stdout.flush()


def _handle_control_line(raw: bytes, emit: Emitter) -> None:
    try:
        message = json.loads(raw.decode("utf-8", errors="replace").strip() or "{}")
    except ValueError:
        return
    if not isinstance(message, dict):
        return
    action = message.get("control")
    if action == "pause":
        _CONTROL.pause()
        emit({"type": "control", "state": "paused"})
    elif action == "resume":
        _CONTROL.resume()
        emit({"type": "control", "state": "running"})


def _start_control_reader(emit: Emitter) -> None:
    # Read the raw stdin fd rather than sys.stdin.buffer: a daemon thread blocked
    # inside a BufferedReader holds its lock, which makes interpreter shutdown
    # abort with "_enter_buffered_busy". os.read touches no Python IO buffer, so
    # the thread can be abandoned cleanly when the process exits.
    try:
        fd = sys.stdin.fileno()
    except (AttributeError, OSError, ValueError):
        return

    if os.name == "nt":
        try:
            import ctypes
            import msvcrt

            handle = msvcrt.get_osfhandle(fd)
            kernel32 = ctypes.windll.kernel32
        except (ImportError, OSError, ValueError, AttributeError):
            return

        def reader_windows() -> None:
            pending = b""
            available = ctypes.c_ulong()
            while True:
                ok = kernel32.PeekNamedPipe(
                    ctypes.c_void_p(handle),
                    None,
                    0,
                    None,
                    ctypes.byref(available),
                    None,
                )
                if not ok:
                    return
                if available.value == 0:
                    time.sleep(0.05)
                    continue
                try:
                    chunk = os.read(fd, min(4096, available.value))
                except OSError:
                    return
                if not chunk:
                    return
                pending += chunk
                while b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    _handle_control_line(line, emit)

        threading.Thread(target=reader_windows, daemon=True).start()
        return

    def reader() -> None:
        pending = b""
        while True:
            try:
                chunk = os.read(fd, 4096)
            except OSError:
                return
            if not chunk:
                return
            pending += chunk
            while b"\n" in pending:
                line, pending = pending.split(b"\n", 1)
                _handle_control_line(line, emit)

    threading.Thread(target=reader, daemon=True).start()


def _progress(emit: Emitter) -> Callable[[str, dict[str, object]], None]:
    def callback(key: str, payload: dict[str, object]) -> None:
        # Block here while paused, but never mid-file (avoid holding a CDN
        # connection open); the high-frequency per-chunk key is exempt.
        if "file_progress" not in key:
            _CONTROL.wait_if_paused()
        emit({"type": "progress", "key": key, "payload": payload})

    return callback


def _settings_result(settings: JsonDict, payload: JsonDict) -> JsonDict:
    consent = is_cookie_consent_recorded()
    cookie = load_cookie() if consent else None
    return {
        "settings": settings,
        "cookie_consent": consent,
        "pixiv_cookie": cookie or "",
        "has_cookie": bool(cookie),
        "cookie_storage": storage_label(),
        "project_root": str(_base_dir(payload)),
        "settings_path": str(_settings_path(payload)),
    }


def _load_settings_for_payload(payload: JsonDict) -> JsonDict:
    return _load_json(_settings_path(payload))


def _command_settings_get(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    return _settings_result(_load_settings_for_payload(payload), payload)


def _command_settings_save(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = dict(payload.get("settings") or {})
    _save_json(_settings_path(payload), settings)

    if "cookie_consent" in payload:
        if payload.get("cookie_consent"):
            record_cookie_consent()
        else:
            revoke_cookie_consent()
            clear_cookie()

    if payload.get("pixiv_cookie") is not None:
        cookie_text = str(payload.get("pixiv_cookie") or "").strip()
        if cookie_text:
            record_cookie_consent()
            save_cookie(cookie_text)
        else:
            clear_cookie()

    return _settings_result(settings, payload)


def _command_cookie_revoke(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    revoke_cookie_consent()
    clear_cookie()
    return _settings_result(_load_settings_for_payload(payload), payload)


def _command_artists_list(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = _load_settings_for_payload(payload)
    db = ArtistDatabase.load(_db_path(payload, settings))
    return {
        "artists": [_artist_to_json(artist) for artist in db.get_many()],
        "db_path": str(db.path),
        "project_root": str(_base_dir(payload)),
    }


def _command_artists_add(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = _load_settings_for_payload(payload)
    artist_id = str(payload.get("artist_id") or "").strip()
    if not artist_id.isdigit():
        raise ValueError("Artist id must be digits")
    name = str(payload.get("name") or "").strip() or None
    save_path = str(payload.get("save_path") or "").strip() or None
    name = _resolve_artist_name_if_missing(artist_id, name, settings)
    db = ArtistDatabase.load(_db_path(payload, settings))
    changed = db.upsert(artist_id, name=name, source="manual", save_path=save_path)
    db.save()
    return {"artist_id": artist_id, "changed": changed, "name": name or "", "save_path": save_path or ""}


def _resolve_artist_name_if_missing(artist_id: str, name: str | None, settings: JsonDict) -> str | None:
    if name:
        return name
    try:
        profile = fetch_user_profile(
            artist_id,
            cookie=load_cookie(),
            allow_insecure_ssl_fallback=bool(settings.get("ssl_fallback", True)),
        )
    except PixivResolveError:
        return None
    return profile.name if profile.name and profile.name != artist_id else None


def _command_artists_assign_folder(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = _load_settings_for_payload(payload)
    artist_id = str(payload.get("artist_id") or "").strip()
    if not artist_id.isdigit():
        raise ValueError("Artist id must be digits")
    folder_text = str(payload.get("folder") or payload.get("save_path") or "").strip()
    if not folder_text:
        raise ValueError("Missing folder")
    folder = _resolve_path(folder_text, _base_dir(payload)).resolve()
    if not folder.is_dir():
        raise ValueError(f"Folder does not exist: {folder}")

    name = _resolve_artist_name_if_missing(artist_id, str(payload.get("name") or "").strip() or None, settings)
    work_ids = collect_local_work_ids([str(folder)])
    db = ArtistDatabase.load(_db_path(payload, settings))
    changed = db.upsert(
        artist_id,
        name=name,
        source=f"manual_unmatched_folder:{folder}",
        save_path=folder,
        work_ids=work_ids,
    )
    db.save()
    return {
        "artist_id": artist_id,
        "changed": changed,
        "name": name or "",
        "save_path": str(folder),
        "work_ids": len(work_ids),
    }


def _command_artists_remove(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = _load_settings_for_payload(payload)
    artist_ids = [str(item).strip() for item in payload.get("artist_ids") or [] if str(item).strip()]
    db = ArtistDatabase.load(_db_path(payload, settings))
    removed = db.remove_many(artist_ids)
    if removed:
        db.save()
    return {"removed": len(removed), "artist_ids": removed}


def _command_artists_rename(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = _load_settings_for_payload(payload)
    old_id = str(payload.get("old_id") or "").strip()
    new_id = str(payload.get("new_id") or "").strip()
    if not new_id.isdigit():
        raise ValueError("Artist id must be digits")
    db = ArtistDatabase.load(_db_path(payload, settings))
    changed = db.rename_artist_id(old_id, new_id)
    name = ""
    if new_id in db.artists:
        try:
            profile = fetch_user_profile(
                new_id,
                cookie=load_cookie(),
                allow_insecure_ssl_fallback=bool(settings.get("ssl_fallback", True)),
            )
            if profile.name and profile.name != new_id:
                db.artists[new_id].name = profile.name
                name = profile.name
        except PixivResolveError:
            pass
    db.save()
    return {"old_id": old_id, "new_id": new_id, "changed": changed, "name": name}


def _command_artists_set_save_path(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = _load_settings_for_payload(payload)
    artist_id = str(payload.get("artist_id") or "").strip()
    save_path = str(payload.get("save_path") or "").strip()
    if not save_path:
        raise ValueError("Missing save path")
    db = ArtistDatabase.load(_db_path(payload, settings))
    changed = db.set_artist_save_path(artist_id, save_path)
    db.save()
    return {"artist_id": artist_id, "changed": changed, "save_path": save_path}


def _command_scan_run(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    settings = _load_settings_for_payload(payload)
    base_dir = _base_dir(payload)
    roots = _paths(payload.get("roots") or settings.get("download_roots"), base_dir)
    exclude_roots = _paths(payload.get("exclude_roots") or settings.get("exclude_roots"), base_dir)
    result = scan_into_database(
        roots,
        _db_path(payload, settings),
        resolve_online=_bool(payload, "resolve_online", bool(settings.get("resolve_online", True))),
        resolve_limit=_int(payload, "resolve_limit", int(settings.get("resolve_limit", 3))),
        resolve_delay=_float(payload, "resolve_delay", 0.8),
        pixiv_cookie=payload.get("pixiv_cookie") or load_cookie(),
        allow_insecure_ssl_fallback=_bool(payload, "ssl_fallback", bool(settings.get("ssl_fallback", True))),
        exclude_roots=exclude_roots,
        fuzzy_search_names=_bool(payload, "fuzzy_search", bool(settings.get("fuzzy_search", False))),
        fuzzy_min_score=_float(payload, "fuzzy_min_score", float(settings.get("fuzzy_min_score", 0.35))),
        progress_callback=_progress(emit_event),
    )
    return _scan_result_to_json(result)


def _command_scan_preview(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    settings = _load_settings_for_payload(payload)
    base_dir = _base_dir(payload)
    roots = _paths(payload.get("roots") or settings.get("download_roots"), base_dir)
    exclude_roots = _paths(payload.get("exclude_roots") or settings.get("exclude_roots"), base_dir)
    result = preview_scan_changes(
        roots,
        _db_path(payload, settings),
        resolve_online=_bool(payload, "resolve_online", bool(settings.get("resolve_online", True))),
        resolve_limit=_int(payload, "resolve_limit", int(settings.get("resolve_limit", 3))),
        resolve_delay=_float(payload, "resolve_delay", 0.8),
        pixiv_cookie=payload.get("pixiv_cookie") or load_cookie(),
        allow_insecure_ssl_fallback=_bool(payload, "ssl_fallback", bool(settings.get("ssl_fallback", True))),
        exclude_roots=exclude_roots,
        fuzzy_search_names=_bool(payload, "fuzzy_search", bool(settings.get("fuzzy_search", False))),
        fuzzy_min_score=_float(payload, "fuzzy_min_score", float(settings.get("fuzzy_min_score", 0.35))),
        progress_callback=_progress(emit_event),
    )
    summary = result.summary
    unmatched: list[dict] = []
    if summary is not None:
        unmatched_sorted = sorted(summary.unmatched_folders.items(), key=lambda item: (-item[1], item[0]))
        unmatched = [{"path": path, "count": count} for path, count in unmatched_sorted]
    return {
        "changes": result.changes,
        "files_seen": summary.files_seen if summary else 0,
        "files_matched": summary.files_matched if summary else 0,
        "excluded_dirs": summary.excluded_dirs if summary else 0,
        "artists": len(summary.artists) if summary else 0,
        "name_only_artists": len(summary.name_only_artists) if summary else 0,
        "resolved_name_only": result.resolved_name_only,
        "fuzzy_resolved_name_only": result.fuzzy_resolved_name_only,
        "ssl_fallback_used": result.ssl_fallback_used,
        "resolve_errors": list(result.resolve_errors),
        "unmatched_folders": unmatched,
    }


def _command_scan_apply(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = _load_settings_for_payload(payload)
    operations = payload.get("operations")
    if not isinstance(operations, list):
        raise ValueError("operations must be a list")
    result = apply_scan_changes(_db_path(payload, settings), [op for op in operations if isinstance(op, dict)])
    return {
        "applied": result.applied,
        "new_artists": result.new_artists,
        "name_changes": result.name_changes,
        "save_paths_added": result.save_paths_added,
        "work_ids_added": result.work_ids_added,
        "db_path": str(result.db_path) if result.db_path else "",
    }


def _command_updates_check(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    settings = _load_settings_for_payload(payload)
    update_check_pages = _int(payload, "update_check_pages", _int(settings, "update_check_pages", 0))
    result = check_artist_updates(
        _db_path(payload, settings),
        artist_ids=[str(item) for item in payload.get("artist_ids") or []] or None,
        pixiv_cookie=payload.get("pixiv_cookie") or load_cookie(),
        allow_insecure_ssl_fallback=_bool(payload, "ssl_fallback", bool(settings.get("ssl_fallback", True))),
        scan_local=_bool(payload, "scan_local_subfolders", bool(settings.get("scan_local_subfolders", False))),
        max_pages=update_check_pages if update_check_pages > 0 else None,
        progress_callback=_progress(emit_event),
    )
    return _update_result_to_json(result)


def _command_updates_download(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    settings = _load_settings_for_payload(payload)
    output_root = payload.get("output_root")
    result = download_artist_updates(
        _db_path(payload, settings),
        artist_ids=[str(item) for item in payload.get("artist_ids") or []] or None,
        output_root=Path(output_root) if output_root else None,
        pixiv_cookie=payload.get("pixiv_cookie") or load_cookie(),
        allow_insecure_ssl_fallback=_bool(payload, "ssl_fallback", bool(settings.get("ssl_fallback", True))),
        overwrite=_bool(payload, "overwrite", False),
        delay_seconds=_float(payload, "delay", 0.3),
        separate_restricted=_bool(payload, "separate_r18", bool(settings.get("separate_r18", False))),
        progress_callback=_progress(emit_event),
    )
    return _download_result_to_json(result)


def _command_similar_run(payload: JsonDict, emit_event: Emitter) -> JsonDict:
    settings = _load_settings_for_payload(payload)
    base_dir = _base_dir(payload)
    roots = _paths(payload.get("roots") or settings.get("download_roots"), base_dir)
    exclude_roots = _paths(payload.get("exclude_roots") or settings.get("exclude_roots"), base_dir)
    result = find_similar_images(
        roots,
        exclude_roots=exclude_roots,
        threshold=str(payload.get("threshold") or settings.get("similar_threshold") or "likely"),
        skip_same_pixiv_work_pages=_bool(
            payload,
            "similar_skip_pixiv_pages",
            bool(settings.get("similar_skip_pixiv_pages", False)),
        ),
        progress_callback=_progress(emit_event),
    )
    return _similar_result_to_json(result)


def _is_unsafe_user_data_dir(user_data_dir: Any, download_roots: Any) -> bool:
    if not user_data_dir:
        return False
    target = Path(str(user_data_dir)).expanduser().resolve()
    for raw in download_roots or []:
        if not str(raw).strip():
            continue
        root = Path(str(raw)).expanduser().resolve()
        if target == root or is_relative_to(target, root):
            return True
    return False


def _command_browser_open(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = _load_settings_for_payload(payload)
    user_data_dir = payload.get("user_data_dir") or settings.get("user_data_dir") or None
    download_roots = payload.get("download_roots") or settings.get("download_roots") or []
    if _is_unsafe_user_data_dir(user_data_dir, download_roots):
        raise ValueError("Browser user data folder cannot be inside a download folder")
    urls = [str(item) for item in payload.get("urls") or []]
    artist_ids = [str(item) for item in payload.get("artist_ids") or []]
    if artist_ids:
        db = ArtistDatabase.load(_db_path(payload, settings))
        urls.extend(artist.pixiv_url for artist in db.get_many(artist_ids))
    open_urls(
        urls,
        browser=payload.get("browser") or settings.get("browser") or None,
        user_data_dir=user_data_dir,
        delay_seconds=_float(payload, "delay", float(settings.get("delay", 1.0))),
    )
    return {"opened": len(urls)}


def _command_file_reveal(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    path_text = str(payload.get("path") or "").strip()
    if not path_text:
        raise ValueError("Missing path")
    path = Path(path_text).expanduser()
    if path.is_dir():
        # Open the folder's contents directly.
        if os.name == "nt":
            subprocess.Popen(["explorer", str(path)])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path)])
    else:
        # Reveal a file by selecting it inside its parent folder.
        if os.name == "nt":
            subprocess.Popen(["explorer", "/select,", str(path)])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path.parent)])
    return {"path": str(path), "opened": True}


def _command_image_thumbnail(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    path_text = str(payload.get("path") or "").strip()
    if not path_text:
        raise ValueError("Missing path")
    max_size = max(48, min(1600, _int(payload, "max_size", 180)))
    path = Path(path_text).expanduser()
    if not path.is_file():
        raise ValueError(f"Image file does not exist: {path}")
    data_url, width, height = _image_thumbnail(path, max_size)
    return {
        "path": str(path),
        "data_url": data_url,
        "width": width,
        "height": height,
    }


COMMANDS: dict[str, Callable[[JsonDict, Emitter], JsonDict]] = {
    "settings.get": _command_settings_get,
    "settings.save": _command_settings_save,
    "cookie.revoke": _command_cookie_revoke,
    "artists.list": _command_artists_list,
    "artists.add": _command_artists_add,
    "artists.assign_folder": _command_artists_assign_folder,
    "artists.remove": _command_artists_remove,
    "artists.rename": _command_artists_rename,
    "artists.set_save_path": _command_artists_set_save_path,
    "scan.run": _command_scan_run,
    "scan.preview": _command_scan_preview,
    "scan.apply": _command_scan_apply,
    "updates.check": _command_updates_check,
    "updates.download": _command_updates_download,
    "similar.run": _command_similar_run,
    "browser.open": _command_browser_open,
    "file.reveal": _command_file_reveal,
    "image.thumbnail": _command_image_thumbnail,
}


def run_command(command: str, payload: JsonDict | None = None, *, emit: Emitter = _emit) -> int:
    payload = dict(payload or {})
    base_dir = _resolve_base_dir(payload.get("project_root"))
    payload["_base_dir"] = str(base_dir)
    os.chdir(base_dir)

    handler = COMMANDS.get(command)
    if not handler:
        emit({"type": "error", "command": command, "message": f"Unknown GUI API command: {command}"})
        return 2

    try:
        result = handler(payload, emit)
    except Exception as exc:  # noqa: BLE001
        emit(
            {
                "type": "error",
                "command": command,
                "message": str(exc),
                "traceback": traceback.format_exc(),
            }
        )
        return 1
    emit({"type": "result", "command": command, "payload": result})
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        _emit({"type": "error", "message": "Missing GUI API command"})
        return 2
    command = argv[0]
    if len(argv) >= 2:
        try:
            payload = json.loads(argv[1])
        except json.JSONDecodeError as exc:
            _emit({"type": "error", "command": command, "message": f"Invalid JSON payload: {exc}"})
            return 2
    else:
        payload = {}
    if not isinstance(payload, dict):
        _emit({"type": "error", "command": command, "message": "Payload must be a JSON object"})
        return 2
    _start_control_reader(_emit)
    return run_command(command, payload)


if __name__ == "__main__":
    raise SystemExit(main())
