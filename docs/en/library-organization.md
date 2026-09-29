# Review Queue, Folder Sync And Collections (Unreleased)

[中文](../zh/library-organization.md)

These features organize records without moving original media. File writes still require explicit download, quarantine, restore or deletion actions.

## Review Queue

Unmatched folders become Review queue. Unapplied scan suggestions survive dismissal and restart. Search paths, candidate names or IDs, and filter by no clues, pending/no result, query failed, conflicting authors, or awaiting confirmation. Unavailable and needs-review flags are independent of recognition status.

Evidence shows candidates, local/online sources, original samples, PIDs, query outcomes and processing time. Author and artwork buttons open the relevant Pixiv pages. Mixed authors never resolve by majority vote.

Retry failed processes only failed samples in the chosen folders. Verify again checks the current folder. More samples adds at most five previously unqueried PIDs per action, with a persistent 30-PID limit per folder. Sampling is dispersed and deduplicated; requests remain spaced and three consecutive failures stop the batch. Targeted retries do not walk unrelated folders.

Confirmation rechecks folder metadata, suggestion revision and the current artist database. Stale results require verification, including remaining folders whose database baseline changed after a partial apply. Manual assignment and exclusion remain available. File notifications only mark evidence stale; they never trigger online recognition.

## Folder Sync

Settings → General enables automatic folder sync by default, only while the app is running. The footer offers a temporary pause and reports progress, pending retries, degraded watching and inaccessible locations.

- Events debounce for one second, with a five-second maximum delay during continuous changes. Only one synchronization task runs at a time.
- Only affected folders are scanned. Partial results merge into the latest catalog; unvisited folders are never inferred to be deleted.
- Changed files need matching size and modification time one second apart. Unstable or unreadable files retain their previous records for retry.
- Startup asynchronously audits downtime changes; recursive metadata audits run every 15 minutes without decoding unchanged images.
- Watch failures and overflow schedule audits. Unavailable locations retry every 60 seconds. Offline roots, permission failures and incomplete enumeration cannot prove deletion.
- Quarantine, application data, backups, caches, partial downloads and directory links escaping configured roots are excluded.
- Scanning, cleanup and backup restoration block sync commits. An obsolete pre-restore generation cannot overwrite restored data.

Sync does not perform artist recognition, Pixiv update checks or downloads. Restoration reloads current state and may resume local metadata reconciliation.

## Collections

Smart collections and Projects share the library sidebar, grid, details, filters and six sorting fields.

Smart collections store the filters and sorting present when created, then dynamically evaluate the complete library. Temporary edits never overwrite saved rules until Update collection rules is chosen. Exclude used and Recently added are additional conditions, defaulting to a 30-day window. First-seen time follows stable image identity. Legacy unknown dates remain null instead of treating every old image as newly added on upgrade. Date rules refresh on foreground entry and every minute.

Projects support multiple persistent, overlapping groups. Select images and Add to project; duplicate memberships are ignored. Removing members, deleting projects and undoing organization never changes original media. References follow stable IDs through verified moves. Missing, inaccessible and quarantined members remain listed with their reasons.

Drag original files exports all available members, regardless of transient filtering. Smart collections use their saved rules; projects use current library sorting. Available and excluded counts are shown. More than 1,000 images requires selecting smaller grid batches, never silent truncation. A file disappearing after availability checking is rejected by native drag validation; refresh and retry.

Collection changes support persistent undo and a separate backup category. Foreign-store restoration only reconnects uniquely verified content; ambiguous references remain pending. Resetting settings/layout or rebuilding an index does not delete collections.

## Storage And Validation

- `scan_review.sqlite3` resides in application data, isolated by the active artist/annotation dataset. Legacy caches migrate only paths and counts, without invented evidence.
- `<index-stem>.collections.sqlite3` resides beside the selected catalog. Members reference `store_id + image_id`; paths are descriptive, not identity.
- Nullable `first_seen_ns` lives in the annotation store and catalog. Legacy rows remain unknown. Adding project members verifies and retains content fingerprints for later move association.
- ZIP v2 adds `collections.sqlite3` and continues reading v1 packages. Review evidence is not a backup category. See [backup compatibility](backup-recovery.md).

New IPC: `scan.review.list/detail/retry/sample/apply`, `library.sync`, `collections.list/create/update/delete/members.add/members.remove`. Collection lists return summaries by default; provide `id` for members. Smart lists accept `image_ids` for original-file availability checks. Sync results contain upserts, removed paths, unavailable locations, pending retries and before/after index digests.

Resident Rust `notify` watchers use `configure_directory_sync`, `poll_directory_sync` and `acknowledge_directory_sync` for generations and queued batches. Python commits use recovery coordination. JSON catalogs remain rebuildable; annotation and collection databases are user data.

Run Python tests, `cargo test --lib`, frontend lint/build and Playwright with two workers. `python scripts/benchmark_library_sync.py` creates an isolated 30,000-image fixture and checks metadata auditing, scoped merging, large-project backup and undo. `scripts/verify_annotation_storage.py <worker.exe>` checks the frozen backend interfaces.

Automated Windows tests cover deep recursive notifications and native original-file drag payloads. Installed-app PureRef drops, physical drive disconnects and network-share-specific watching still require manual acceptance; browser mocks cannot validate those integrations.
