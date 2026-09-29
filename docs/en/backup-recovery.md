# Backup And Safe Undo (Unreleased)

[中文](../zh/backup-recovery.md)

Open Settings → Backup & recovery. The artist and library More menus also offer undo, and successful annotation edits show a temporary undo notification.

## Automatic Backups

- Snapshots live in `.pixiv-pbd-manager/backups/` in the active application data directory; `recovery.sqlite3` stores the catalog and operation journal. Custom database/index paths have separate dataset histories.
- The first write of the day creates a daily backup when content changed; 14 are retained. Batch edits, applied scans, artist deletion, artist-tag definition changes, work-index rebuilds and settings resets create pre-operation restore points; 20 are retained.
- Manual and imported backups are not automatically removed. Export ZIP packages to another disk for hardware-failure protection; local snapshots alone are insufficient.
- Includes artists, image annotations, settings and persistent UI preferences, plus a separate Collections category. Excludes original images, thumbnails, cookies, consent state, browser profiles and transient filter caches.
- Daily failures remain visible. A failed mandatory restore point blocks the corresponding high-risk edit; existing snapshots are not removed to make room.

## Restoring

Choose a backup, select categories, inspect counts, differences and unavailable paths, then confirm. The preview shows up to 50 differences per category; totals cover all changes. Current state receives a restore point first.

Selected categories return to the snapshot date, replacing later organization edits; unselected categories remain unchanged. Annotation restoration uses stable IDs and changes only tags, favorites, ratings and markers, not current file paths, fingerprints or quarantine state. Images added later keep their files but lose later annotations.

Foreign annotation stores match automatically only when verified content corresponds uniquely. Ambiguous duplicates, missing files and unverified records enter Unlinked annotations. Restoring a backup never moves, restores or permanently deletes media and cannot undo a permanent quarantine deletion.

Storage locations remain local. Imported settings retain the current browser program, Python command and browser profile directory; other unavailable paths appear in the preview. Packages contain local paths and personal organization data, so consider privacy before sharing.

Wait for active tasks, metadata writes and settings saves before restoring. Preparation can be cancelled; committing completes or rolls back without killing the worker. The UI reloads without automatically starting online recognition or downloads; enabled folder synchronization rechecks local metadata.

Collection restoration changes only rules and membership, preserving current file identity, location and quarantine state. Foreign-store members reconnect only through uniquely verified content; ambiguous references remain pending. Deleting a collection never deletes original files.

## Undo

- Covers image tags, favorites, ratings and markers, plus manual folder assignment, artist-ID changes, save-path changes and collection edits.
- The latest 20 successful operations survive restart and undo in reverse order. A batch counts once; failures and no-ops do not. No redo in v1.
- Unrelated subsequent field edits survive. A conflict affecting any item rejects the entire undo; nothing is partially reverted. Discard that undo entry to proceed to earlier operations.
- Applied scans, artist deletion and artist-tag definition changes appear as "Restore from backup only" in history. Restoring categories invalidates their earlier undo history.
- Resetting settings/layout or rebuilding indexes does not erase backups or history.

## Compatibility And Safety

New format v2 packages add collection SQLite data and continue reading v1 packages without collections. A manifest and SHA-256 checksums allow at most 64 allowlisted files and 1 GiB total uncompressed data. Unknown versions, traversal, links, abnormal compression and SQLite triggers are rejected.

SQLite snapshots use the backup API instead of copying an open database. Prepared transactions recover before later writes after interruption. Damaged artist JSON cannot be overwritten by an ordinary save; restoration preserves its original bytes.

Do not edit one data directory simultaneously with old and new app versions: older versions do not participate in the new lock/journal protocol. Exit before manually copying a full data directory. Neither `recovery.sqlite3` nor the annotation database is disposable cache.
