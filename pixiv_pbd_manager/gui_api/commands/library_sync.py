"""Batched native notifications and periodic metadata audits share one commit path."""

import hashlib
from pathlib import Path
import json

from ...database import ArtistDatabase
from ...library import apply_tag_cache, build_catalog, build_pid_to_artist, build_save_path_index, load_tag_cache, read_library_index, save_library_index, save_library_index_metadata
from ...library.annotations import annotated_catalog
from ...library.annotation_store import path_key
from ...library.annotation_identity import reconcile, ProtectionCancelled
from ...library.sync import scopes_for, discover, stable_files, covered, within, outside, confirm_missing
from ...paths import DATA_DIR, DEFAULT_CLEANUP_STATE
from ...recovery import ACTIVE
from ...recovery.collection_restore import relink_pending
from ...recovery.locking import data_lock
from ...scan_review import database_signature, open_reviews
from ...scanner import normalize_exclude_roots
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
        excludes.append(resolve_path(settings["quarantine_dir"], base_dir(payload)))
    cleanup_path = resolve_path(payload.get("cleanup_state_path") or DEFAULT_CLEANUP_STATE, base_dir(payload))
    if cleanup_path.exists():
        # A corrupt cleanup ledger is not evidence that historical quarantine
        # roots are safe to scan. Fail closed and retain the current index.
        cleanup = json.loads(cleanup_path.read_text(encoding="utf-8"))
        excludes.extend(resolve_path(operation["quarantine_root"], base_dir(payload))
                        for operation in cleanup.get("operations", []) if operation.get("quarantine_root"))
    excludes = normalize_exclude_roots(excludes)
    scopes = scopes_for(payload.get("changed_paths", []), roots, bool(payload.get("full")))
    index = _index_path(payload)
    # Fingerprint and parse the same bytes (the digest database_signature
    # gives): once the commit proves the index unchanged it reuses this parse.
    raw = index.read_bytes() if index.exists() else b""
    before_version = hashlib.sha256(raw).hexdigest()
    old, indexed_store = read_library_index(raw)
    try:
        found, completed, unreadable, unavailable = discover(scopes, roots, excludes, CONTROL.is_cancelled)
        stable, pending = stable_files(found, old)
        db = ArtistDatabase.load(db_path(payload, settings))
        images, summary = build_catalog(roots, excludes, old_catalog=old, file_paths=stable,
                                        pid_to_artist=build_pid_to_artist(db), save_path_index=build_save_path_index(db),
                                        progress_callback=make_progress_callback(emit), should_cancel=CONTROL.is_cancelled)
        parsed = {image.path for image in images}
        # A stable file that is not a readable image is skipped, as a rescan
        # skips it. Requeueing it would retry forever; a later write to it
        # arrives as a new change.
        broken = {str(path) for path in stable if str(path) not in parsed}

        def unseen(paths):
            # Inside a fully walked scope and outside excluded or unreadable
            # folders, yet the walk did not see them.
            return {path for path in covered(set(paths) - found.keys(), completed)
                    if not within(Path(path), [*excludes, *unreadable])}
        absent = unseen(old)
        missing = {path for path in absent if not Path(path).exists()}
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
            with annotated_catalog(index, old) as (store, fresh):
                # A lost or rebuilt index no longer lists every bound file; a row
                # whose file the walk proved gone is missing all the same.
                linked = store.connection.execute("SELECT path FROM images WHERE status='linked'")
                missing |= {path for path in unseen(path for (path,) in linked if path not in old) if not Path(path).exists()}
                missing, offline = confirm_missing(missing, roots)
                unavailable.extend(offline)
                images = reconcile(store, valid, roots, CONTROL.is_cancelled, missing_paths=missing, catalog=fresh)
                apply_tag_cache(images, load_tag_cache(_tag_cache_path(payload)))
                removed = (missing | broken) & fresh.keys()
                # After a case-only rename the walk misses the old spelling, which
                # still "exists" on a case-insensitive volume; the new one replaces it.
                spellings = {path_key(image.path): image.path for image in images}
                removed |= {path for path in absent - missing if spellings.get(path_key(path), path) != path} & fresh.keys()
                if payload.get("full") and not unavailable:
                    # Only a complete audit may drop entries under a removed root or
                    # a new exclude; an unreachable root may be a half-typed path.
                    removed |= outside(fresh, roots, excludes)
                merged = {path: image for path, image in fresh.items() if path not in removed}
                merged.update((image.path, image) for image in images)
                upserts = [image for image in images if image.path not in fresh or image.to_json() != fresh[image.path].to_json()]
                # Unchanged files were not rebuilt, so an audit that found nothing
                # new leaves the index file as it is.
                saved = bool(removed or upserts) or indexed_store != store.store_id
                if saved:
                    save_library_index(merged.values(), index, annotation_store_id=store.store_id)
                annotation_status = store.status()
            if payload.get("full") and not unavailable and not pending:
                save_library_index_metadata(index, roots, configured_excludes, entry_count=len(merged))
            with open_reviews(payload, settings) as review:
                review.mark_stale([*removed, *(image.path for image in upserts)], [item["path"] for item in unavailable])
            artist_for = _artist_lookup(ArtistDatabase.load(db_path(payload, settings)))
            result = {"upserts": [library_image_to_json(image, artist_for(image)) for image in upserts],
                      "removed": sorted(removed), "base_version": before_version,
                      "index_version": database_signature(index) if saved else before_version,
                      "unavailable": unavailable, "pending": sorted(set(pending)), "annotation_status": annotation_status,
                      "files_seen": summary.files_seen, "reused": summary.reused, "indexed": len(merged)}
    except ProtectionCancelled:
        return {"cancelled": True}
    if payload.get("full") and not unavailable:
        relink_pending(session)
    return result
