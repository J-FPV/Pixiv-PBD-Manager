# Release Notes

[中文](../zh/release-notes.md)

## v0.1.10

A focused release on Pixiv tag fetching. The installer can upgrade an existing installation in place; `artists.json`, the library index, similar-image results, quarantine history, and settings remain intact.

### Incremental Tag Fetching

- Artworks that were already fetched are no longer re-fetched. Tag records now live in `.pixiv-pbd-manager/pixiv_tags.json`, keyed by work id, and a successful fetch is reused indefinitely.
- The first upgraded run adopts the tags already present in the library index, so changing the storage format does not trigger a full re-fetch.
- The toolbar keeps Fetch Pixiv tags (only artworks never fetched) and gains Re-fetch tags, which ignores the cache. The single-image button in the detail view always re-fetches.
- A failed fetch is retried on the next run. After three consecutive failures it is retried weekly instead, so deleted or private artworks stop slowing down every later run.
- When everything in the list is already cached, the app says so rather than looking like the button did nothing.

### Fixes

- Fetched tags survive organizing and renaming. Tags used to be keyed by file path, and similar-image cleanup moves files, so the next scan cleared them and forced a full re-fetch.
- Fetching checkpoints every 25 artworks, so cancelling or crashing partway keeps the work already done.
- JSON writes go to a temporary file and are then swapped into place atomically. A write interrupted partway used to leave a truncated file, which the readers treat as empty — silently losing the whole index.
- Ratings, favorites, and tag edits made during a long tag fetch are no longer reverted when it finishes.

### Upgrade Notes

- Exit the previous version before installing `Pixiv.PBD.Manager_0.1.10_x64-setup.exe`.
- User data still defaults to `%APPDATA%\PixivPbdManager\.pixiv-pbd-manager\`.
- This release adds `pixiv_tags.json`. Downgrading still works; older builds simply ignore the file.

Full code comparison: [v0.1.9...v0.1.10](https://github.com/J-FPV/Pixiv-PBD-Manager/compare/v0.1.9...v0.1.10)

## v0.1.9

This release focuses on asset organization and smoother interaction with large libraries. The installer can upgrade an existing installation in place; `artists.json`, the library index, similar-image results, quarantine history, and settings remain intact.

### Library Organization

- Images now support favorites, 0–5 star ratings, and High reference value / Used / To organize workflow markers.
- Local image tags, copying indexed Pixiv tags, and multi-image batch editing are available.
- CSV export writes selected images, or the current filtered result when nothing is selected.
- Library Doctor checks the database, missing/overlapping paths, unsafe browser profiles, quarantine safety, and index status without changing files.
- Stale indexes and changed roots can refresh incrementally in the background without blocking artist or similar-image work.

### Preview And Similar Images

- Library details and similar-image previews initially fit complete tall and portrait images before wheel zoom and drag panning.
- Library navigation buttons now sit beside the image.
- Similar results, quarantine operations, and files within an operation are paginated to avoid rendering large histories at once.
- Quarantine keeps its move-first, recoverable design; permanent deletion still requires a second confirmation.

### Scanning, Recognition, And Tasks

- Scans can be cancelled, and a dismissed scan preview can be reopened from Scan results.
- Artist links in Scan Preview open Pixiv so proposed matches can be verified before applying them.
- Online folder resolution samples artwork IDs from newer, middle, and older positions; one unavailable work no longer makes the folder fail.
- Local file handling, download progress, and Explorer selection behavior were refined.

### Performance And Reliability

- Large-library tag toggles, filtering, and facet counts use deferred recomputation to reduce visible stalls.
- Favorite, rating, and workflow controls respond immediately while backend writes are serialized to prevent rapid-click races.
- Fixed the misplaced checkbox in the batch-tag dialog.
- Stdin JSON is handled as UTF-8 and accepts UTF-8 BOM input from Windows PowerShell 5.1.

### Upgrade Notes

- Exit the previous version before installing `Pixiv.PBD.Manager_0.1.9_x64-setup.exe`.
- User data remains under `%APPDATA%\PixivPbdManager\.pixiv-pbd-manager\` by default.
- The app never removes library files automatically; similar-image cleanup still moves only confirmed files into a user-selected quarantine folder outside the library.

Full code comparison: [v0.1.8...v0.1.9](https://github.com/J-FPV/Pixiv-PBD-Manager/compare/v0.1.8...v0.1.9)
