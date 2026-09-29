"""Batched native notifications and periodic metadata audits share one commit path."""

from pathlib import Path
import json

from ...database import ArtistDatabase
from ...library import apply_tag_cache, build_catalog, build_pid_to_artist, build_save_path_index, load_tag_cache, load_library_index, save_library_index, save_library_index_metadata
from ...library.annotations import annotated_catalog
from ...library.annotation_identity import reconcile, ProtectionCancelled
from ...library.sync import scopes_for, discover, stable_files, covered, within, confirm_missing
from ...paths import DATA_DIR, DEFAULT_CLEANUP_STATE
from ...recovery import ACTIVE
from ...recovery.locking import data_lock
from ...scan_review import database_signature, open_reviews
from ..payload import base_dir, db_path, resolve_path
from ..runtime import CONTROL, make_progress_callback
from ..serializers import library_image_to_json
from .library import _index_path, _tag_cache_path, _scan_paths, _artist_lookup
from .settings import load_settings_for_payload


def sync(payload, emit):
    session = ACTIVE.get()
    if session is None:
        raise ValueError("Sync requires a recovery session")
    settings = load_settings_for_payload(payload)
    roots, excludes = _scan_paths(payload, settings)
    configured_excludes = list(excludes)
    excludes.append(base_dir(payload) / DATA_DIR)
    if settings.get("quarantine_dir"):
        excludes.append(Path(settings["quarantine_dir"]).resolve())
    cleanup_path = resolve_path(payload.get("cleanup_state_path") or DEFAULT_CLEANUP_STATE, base_dir(payload))
    if cleanup_path.exists():
        # A corrupt cleanup ledger is not evidence that historical quarantine
        # roots are safe to scan. Fail closed and retain the current index.
        cleanup = json.loads(cleanup_path.read_text(encoding="utf-8"))
        excludes.extend(resolve_path(operation["quarantine_root"], base_dir(payload))
                        for operation in cleanup.get("operations", []) if operation.get("quarantine_root"))
    scopes = scopes_for(payload.get("changed_paths", []), roots, bool(payload.get("full")))
    index = _index_path(payload)
    old = load_library_index(index)
    before_version = database_signature(index)
    try:
        found, completed, unavailable = discover(scopes, roots, excludes, CONTROL.is_cancelled)
        stable, pending = stable_files(found, old)
        db = ArtistDatabase.load(db_path(payload, settings))
        images, summary = build_catalog(roots, excludes, old_catalog=old, file_paths=stable,
                                        pid_to_artist=build_pid_to_artist(db), save_path_index=build_save_path_index(db),
                                        progress_callback=make_progress_callback(emit), should_cancel=CONTROL.is_cancelled)
        parsed = {image.path for image in images}
        pending.extend(str(path) for path in stable if str(path) not in parsed)
        missing = {path for path in old if path not in found and covered(path, completed)
                   and not within(Path(path), excludes) and not Path(path).exists()}
        # Recheck after image reads; a file can disappear or be replaced mid-batch.
        valid = []
        for image in images:
            try:
                stat = Path(image.path).stat()
                if (stat.st_size, stat.st_mtime_ns) == found[image.path]:
                    valid.append(image)
                else:
                    pending.append(image.path)
            except OSError:
                pending.append(image.path)
        with data_lock([session.directory / "sync-commit"]), session.guard():
            if CONTROL.is_cancelled():
                raise ProtectionCancelled()
            if database_signature(index) != before_version:
                raise ValueError("Index changed during sync; retry this batch")
            current_settings = load_settings_for_payload(payload)
            if any(current_settings.get(key) != settings.get(key) for key in ("download_roots", "exclude_roots", "quarantine_dir", "auto_sync")):
                raise ValueError("Sync settings changed; retry with the current configuration")
            missing, offline = confirm_missing(missing, roots)
            unavailable.extend(offline)
            with annotated_catalog(index) as (store, fresh):
                images = reconcile(store, valid, roots, CONTROL.is_cancelled, missing_paths=missing)
                apply_tag_cache(images, load_tag_cache(_tag_cache_path(payload)))
                merged = {path: image for path, image in fresh.items() if path not in missing}
                merged.update((image.path, image) for image in images)
                upserts = [image for image in images if image.path not in fresh or image.to_json() != fresh[image.path].to_json()]
                save_library_index(merged.values(), index, annotation_store_id=store.store_id)
                annotation_status = store.status()
            if payload.get("full") and not unavailable and not pending:
                save_library_index_metadata(index, roots, configured_excludes, entry_count=len(merged))
            with open_reviews(payload, settings) as review:
                review.mark_stale([*missing, *(image.path for image in upserts)], [item["path"] for item in unavailable])
            artist_for = _artist_lookup(ArtistDatabase.load(db_path(payload, settings)))
            return {"upserts": [library_image_to_json(image, artist_for(image)) for image in upserts],
                    "removed": sorted(missing), "index_version": database_signature(index), "base_version": before_version,
                    "unavailable": unavailable, "pending": sorted(set(pending)), "annotation_status": annotation_status,
                    "files_seen": summary.files_seen, "reused": summary.reused, "indexed": len(merged)}
    except ProtectionCancelled:
        return {"cancelled": True}
