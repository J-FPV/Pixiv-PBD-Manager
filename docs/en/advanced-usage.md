# Advanced Usage

[中文](../zh/advanced-usage.md)

This document keeps the details that were moved out of the root README. Most users only need the root README; use this page when you need recognition rules, CLI commands, cookie risks, or downloader behavior.

## Legacy Folder Recognition

The most reliable setup is to include the Pixiv artist ID in folder or file names:

```text
pixiv/{user}-{user_id}/{id}-{title}
```

The scanner first checks folder names such as:

```text
ArtistName-123456
ArtistName (123456)
[123456] ArtistName
123456 - ArtistName
```

Then it checks file names for common fields:

```text
98765432_user_id_123456_title.jpg
98765432_uid-123456_title.png
98765432_member_id=123456_title.webp
```

If an old folder has an artist name but no artist ID:

```text
C:\PixivLibrary\ArtistName's illustrations - pixiv\12345678_p0.jpg
```

the GUI can use artwork IDs in file names to query Pixiv online and resolve the artist ID. Offline scanning can only treat these folders as unmatched or name-only candidates.

For manually named folders such as:

```text
C:\PixivLibrary\illus-ArtistName-style-tag\12345678_p0.jpg
```

enable fuzzy artist-name search. Because manually typed names may be inaccurate, test a small folder set with a higher threshold before scanning a large library.

## Direct Downloads

In the GUI, click Check updates first. When the New column shows counts, click Download updated.

- If artists are selected, only selected artists are downloaded.
- If none are selected, all artists with updates are downloaded.

Direct download does not use Powerful Pixiv Downloader. The app reads new artwork IDs found by update checks and requests Pixiv's pages API:

```text
https://www.pixiv.net/ajax/illust/{work_id}/pages
```

The app reads each page's `urls.original` image URL and downloads it with Python.

Requests to `*.pixiv.net` include a `Referer`, browser-style `User-Agent`, and optional Pixiv cookie. Image downloads from `i.pximg.net` include only the `Referer`, not the cookie.

Downloaded files use:

```text
artworkID_pPage.extension
```

Example:

```text
12345678_p0.jpg
12345678_p1.png
```

If an artist has no save path, the CLI can use `--output-root` as a fallback. In the GUI, scan existing folders first so save paths are recorded.

The direct downloader does not use PBD naming rules or filters. Public artworks usually download directly; login-only, age-restricted, or hidden artworks may require a Pixiv cookie.

## Parallel Download

The "Download concurrency" setting controls how many artworks download at once (1–5, default 1). Update downloads run through a thread pool:

- Higher values are faster but open more concurrent requests to Pixiv, which **makes rate-limiting or CAPTCHAs more likely** — 1–2 is recommended.
- Besides the Total bar, the bottom-right task window shows one progress bar per concurrent slot, each tracking the image currently downloading on that slot (filename + bytes / speed).
- The maximum is 5, clamped on both the client and the server.

## R-18 / R-18G Subfolder

Settings can route restricted artworks into `[R-18&R-18G]` inside the artist folder.

- The downloader checks each artwork's `xRestrict` value.
- R-18 / R-18G works go into `[R-18&R-18G]`.
- All-ages works stay in the artist folder root.
- Restricted-artwork failures are logged per artwork ID.

## Local Subfolder Scan During Update Checks

Update checks now always read artwork IDs directly under each artist's save-path root before comparing against Pixiv. If you manually download an image and place it in the artist's root save folder, the next update check treats it as already saved.

If you organize artworks into subfolders, enable recursive local subfolder scanning during update checks. The app will also read artwork IDs under child folders so already saved files are not reported as new.

The update page limit controls how many newest profile pages are checked. `0` means all works; values above `0` are faster but may miss older additions.

## Similar Image Rules

Open Similar Images in the GUI and optionally enter dedicated scan and exclude folders. Empty scan folders fall back to the current download folders; Similar Images exclude folders are saved independently and do not automatically reuse the normal scan exclude folders. Damaged or unreadable images are counted as errors and summarized in the log.

Supported formats:

```text
.jpg .jpeg .png .webp .bmp .gif
```

Animated GIF / WebP files use the first frame.

Each image record stores:

- Absolute path
- File size and modified time
- Resolution
- `sha256`
- `pHash`
- `dHash`

The index is saved at:

```text
.pixiv-pbd-manager/image_index.json
```

Matching rules:

- Same `sha256`: exact duplicate.
- `pHash <= 6` and `dHash <= 10`: highly similar.
- `pHash <= 10` and `dHash <= 14`: possibly similar.

You can skip comparisons between split pages of the same Pixiv work, such as `{pid}_p0`, `{pid}_p1`, and `{pid}_p2`.

### Safe Cleanup And Quarantine

The scan result recommends a stable copy to keep using pixel area, file size, modified time, and path:

- Exact duplicates receive an automatic cleanup suggestion.
- Highly similar groups receive a suggestion only when their aspect ratios are close.
- Possibly similar groups are never preselected.

The app never moves or deletes images automatically. After you click Clean selected and confirm, selected files move to a user-chosen quarantine folder outside the library, and every group keeps at least one image. The Quarantine view supports restore and manual permanent deletion. Restore skips an existing destination and never overwrites it.

Ignored groups and cleanup history are stored in `.pixiv-pbd-manager/cleanup_state.json`, separate from `artists.json`, and Reset all settings does not remove them. Every quarantine operation also creates its own task folder with a UTF-8 `manifest.json`. Quarantined files never expire automatically; permanent deletion is only available manually in Quarantine and requires a second confirmation.

Cleanup confirmation lists the keep set separately from the quarantine set. Results summarize group counts and reclaimable space for Exact / Highly similar / Possibly similar matches, and each group explains its recommendation rule. Quarantine records can open their task folder directly, while failed items keep their error reason for troubleshooting.

## Library Index And Doctor

The catalog is stored in `.pixiv-pbd-manager/library_index.json`; `library_index.meta.json` stores scan time, scan/exclude folders, and root-folder timestamps. If the index is older than six hours, folder settings change, or a root changes, the desktop app starts an independent incremental refresh. Unchanged dimensions and tags are reused. Its task lane does not block artist update checks or similar-image scans.

Library Doctor is a read-only diagnostic for database readability, missing or overlapping artist save paths, browser profiles placed inside the library, quarantine safety/writability, and index freshness. It never creates, moves, or deletes images.

Image favorites, 0–5 star ratings, local tags, and the High reference value / Used / To organize workflow markers are stored in `library_index.json` and survive incremental rescans. Use the top-left selector on thumbnails to edit these fields in bulk. “Add Pixiv tags to local tags” copies tags already present in the index and does not make another network request.

“Export list” writes a UTF-8 BOM CSV. It exports selected images when a selection exists and otherwise exports the current filter result, so filter by artist, folder, tag, rating, or workflow status before exporting a focused asset list.

## Pixiv Cookie And Privacy Risks

Restricted or login-only artworks may require a Pixiv session cookie, usually `PHPSESSID`. The account must also allow R-18 viewing in Pixiv settings.

A cookie is a login credential. Anyone with a valid `PHPSESSID` may be able to:

- Read private bookmarks, messages, purchase history, and follow lists.
- Like, follow, comment, post or delete artworks as you.
- Change some account information.
- Operate Pixiv Booth / Fanbox purchases or patronage.

Pixiv 2FA only protects new password logins; it does not protect an already active session.

The app requires explicit cookie risk consent:

- **GUI**: tick the cookie risk checkbox and accept the disclaimer.
- **CLI**: pass `--accept-cookie-risk` the first time you use `--pixiv-cookie`.

Consent is stored at:

```text
.pixiv-pbd-manager/consent.json
```

Cookie storage:

- Windows: encrypted with DPAPI into `.pixiv-pbd-manager/cookie.bin`.
- Non-Windows: stored in `.pixiv-pbd-manager/cookie.txt` with `0600` permissions.
- It is not written to `gui_settings.json`.
- `.pixiv-pbd-manager/` is ignored by Git.

Recommendations:

1. Use a dedicated Pixiv account.
2. Do not put the project folder in a cloud-sync directory.
3. Revoke the session on Pixiv when done.
4. If you suspect a leak, revoke all sessions immediately.

## SSL Fallback

If Python hits `CERTIFICATE_VERIFY_FAILED`, the GUI retries once with a compatibility fallback by default. The CLI does the same.

Use strict verification with:

```powershell
python -m pixiv_pbd_manager scan "C:\PixivLibrary" --resolve-online --no-ssl-fallback
```

## Common CLI Commands

Scan existing downloads:

```powershell
python -m pixiv_pbd_manager scan "C:\PixivDownloads"
```

Scan legacy folders and resolve artist IDs online:

```powershell
python -m pixiv_pbd_manager scan "C:\PixivLibrary" --resolve-online
```

Enable fuzzy artist-name search:

```powershell
python -m pixiv_pbd_manager scan "C:\PixivLibrary" --resolve-online --fuzzy-search
```

Exclude a folder:

```powershell
python -m pixiv_pbd_manager scan "C:\PixivLibrary" --exclude "C:\PixivLibrary\misc"
```

Check updates:

```powershell
python -m pixiv_pbd_manager check
```

Rescan local save paths before checking updates:

```powershell
python -m pixiv_pbd_manager check --scan-local
```

Check only the newest two profile pages:

```powershell
python -m pixiv_pbd_manager check --max-pages 2
```

Download newly detected artworks:

```powershell
python -m pixiv_pbd_manager download
```

Save restricted works into `[R-18&R-18G]`:

```powershell
python -m pixiv_pbd_manager download --separate-r18
```

Find similar images and export CSV:

```powershell
python -m pixiv_pbd_manager similar "C:\PixivLibrary" --output similar_report.csv
```

Manually add an artist:

```powershell
python -m pixiv_pbd_manager add 123456 --name "artist name"
```

Open recorded artist pages:

```powershell
python -m pixiv_pbd_manager open
```

Use a custom database path:

```powershell
python -m pixiv_pbd_manager scan --db "C:\PixivData\artists.json" "C:\PixivDownloads"
```

Use a specific browser:

```powershell
python -m pixiv_pbd_manager open --browser "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

Use a specific browser profile:

```powershell
python -m pixiv_pbd_manager open --browser "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir "C:\PixivBrowserProfile"
```
