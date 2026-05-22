# Pixiv PBD Manager

[中文 README](README.md)

Pixiv PBD Manager is a local Pixiv download manager. It can work with the browser extension Powerful Pixiv Downloader, and it can also directly download newly detected artworks with its own downloader.

It scans existing image folders, records Pixiv artist IDs, artist names, known artwork IDs, newly available artwork IDs, and per-artist save paths so future updates are easier to fetch.

## How It Works

1. Scan existing download folders to identify artists, artworks, and save paths.
2. Store artist IDs, artist names, known artwork IDs, and newly available artwork IDs.
3. Check Pixiv for each recorded artist to find artworks not yet saved locally.
4. Open artist pages for PBD, or use "Download updated" to download updates directly.
5. Scan again after downloading to refresh the local database.

## Recommended PBD Naming Rule

It is recommended to include the artist ID in Powerful Pixiv Downloader's naming rule:

```text
pixiv/{user}-{user_id}/{id}-{title}
```

This lets the scanner identify artists directly from folders like `Artist-ArtistID`. The tool also tries to read `uid`, `user_id`, `member_id`, `artist_id`, and similar fields from file names.

## Quick Start

Run these commands from this folder:

```powershell
pip install -e .
python -m pixiv_pbd_manager scan "C:\PixivDownloads"
python -m pixiv_pbd_manager list
python -m pixiv_pbd_manager open --limit 10
```

Requires Python 3.9 or newer.

## Desktop GUI

The primary desktop GUI is Tauri + React + TypeScript in [desktop](desktop/). The old Tkinter GUI is frozen on a separate branch; main no longer maintains Tkinter entry points.

Development requires Node.js, npm, Rust, Cargo, and a Python environment where `pip install -e .` has been run from the repository root. The Tauri UI is still a development build: it launches `python -m pixiv_pbd_manager.gui_api` through the Tauri shell plugin, so it is not yet a Python-free end-user installer. The planned packaging path is a PyInstaller sidecar for the Python backend.

```powershell
pip install -e .
cd desktop
npm install
npm run tauri:dev
```

If the Tauri UI cannot import `pixiv_pbd_manager`, set `Project root` in the Settings tab to the repository root.

Restart `npm run tauri:dev` after changing `desktop/src-tauri/`, Tauri plugins, or permission files. Pure frontend and Python backend changes usually hot reload.

Main desktop features:

- Choose the database location.
- Add one or more download folders.
- Add excluded folders so scans skip them.
- Scan download folders and write artists into the database.
- Resolve Pixiv folders that have artist names but no artist IDs.
- Optionally enable fuzzy artist-name search for manual folders like `illus-artist-style-tag`.
- Check whether recorded artists have new Pixiv artworks and show the count in the "New" column.
- When checking updates, recursively scan artist save paths so artworks already saved in subfolders are not reported as new.
- Optionally check only the newest N artwork pages on each artist profile; 0 checks all works.
- Directly download artworks listed as new without manually clicking PBD.
- Optionally route R-18/R-18G downloads into a `[R-18&R-18G]` subfolder.
- Show each detected artist's save path in the table.
- Switch between Chinese and English in the Settings tab; the choice is saved automatically.
- Use the Settings tab to configure directories, scan parsing, browser options, Pixiv cookies, SSL fallback, and open delay.
- View, search, sort, and manually add artists; search matches artist IDs, names, and save paths/folder names.
- Right-click an artist to edit the Pixiv artist ID; the app will try to update the artist name automatically.
- Right-click an artist to edit the save path.
- Click the blue checkbox in the first table column to pick multiple artists, or use "Select all / Clear all".
- Update checks, opening selected artists, and direct downloads operate on checked artists.
- While a background scan, check, or download is running, you can still double-click an artist row to open that artist's browser page. Double-click opens only the clicked artist and ignores the checked list.
- Copy artist artwork-page URLs.
- Find similar images with custom scan/exclude folders and review candidate duplicate groups across different names, formats, or resolutions.

## Browser Profile Warning

If your default browser is not the one with Powerful Pixiv Downloader installed, set the Chrome/Edge executable path and user data directory in the browser section of the Settings tab.

Do not set "browser user data" to your image download folder. Chrome/Edge creates profile folders such as `Default`, `Safe Browsing`, `ShaderCache`, and `Webstore Downloads` there. The GUI blocks user-data folders inside download roots; if unsure, leave it blank to use the system default browser profile.

## Legacy Folder Recognition

If an old folder looks like this:

```text
C:\PixivLibrary\ArtistName's illustrations／manga - pixiv\12345678_p0.jpg
```

This folder has an artist name but no Pixiv artist ID. The GUI enables online resolution for no-ID Pixiv folders by default. During scanning, it uses artwork IDs from file names to query Pixiv, resolves the artist ID, then writes it into the database. Offline scanning can only mark these as name-only folders and cannot generate usable artist update pages.

If an old folder looks like this:

```text
C:\PixivLibrary\illus-ArtistName-style-tag\12345678_p0.jpg
```

Here, `ArtistName` is treated as a candidate artist name. When "Fuzzy-search artist names" is enabled, the app searches Pixiv users online and tries to match the artist ID. Because manually typed names may be inaccurate, this option is disabled by default; try a small folder set with a higher score threshold before scanning a large library.

## SSL Certificate Fallback

If your Python environment hits `CERTIFICATE_VERIFY_FAILED`, the GUI retries once with a compatibility fallback by default. The CLI also enables this fallback by default. Add `--no-ssl-fallback` if you want strict certificate verification.

## Direct Automatic Download

In the GUI, click "Check updates" first. Once the "New" column shows counts, click "Download updated". If some artists are checked, only their new artworks are downloaded; if none are checked, all artists with updates are downloaded.

Direct download does not use Powerful Pixiv Downloader. It uses the app's own downloader. The app reads new artwork IDs found by "Check updates", requests Pixiv's artwork pages API:

```text
https://www.pixiv.net/ajax/illust/{work_id}/pages
```

It extracts each page's `urls.original` image URL, then downloads the files with Python. Pixiv API requests include the artwork page `Referer`, a browser-style `User-Agent`, and an optional Pixiv cookie; image downloads from `i.pximg.net` carry **only the Referer — not the cookie** — so the session is not leaked to the image CDN.

The direct downloader saves files to each artist's recorded save path. File names use:

```text
artworkID_pPage.extension
```

Example:

```text
12345678_p0.jpg
12345678_p1.png
```

When checking updates, you can enable "Scan artist subfolders when checking updates". The app first recursively reads artwork IDs already present under each artist's save path, then compares them with Pixiv's remote list, so works already saved in subfolders are not reported as new.

If an artist has no save path, the CLI can use `--output-root` as a fallback directory. In the GUI, it is best to scan existing folders first so the app can record save paths.

Note: The direct downloader does not use PBD naming rules or filters. Public artworks usually download directly; login-only, age-restricted, or hidden artworks may require Pixiv cookies.

Settings can also route R-18/R-18G works into a `[R-18&R-18G]` subfolder. When enabled, the downloader checks each artwork's `xRestrict` value first; restricted works are saved under `[R-18&R-18G]` inside the artist folder, while all-ages works stay in the artist folder root. Restricted artwork failures are reported per artwork in the log.

## Similar Image Detection

Open the "Similar Images" tab in the GUI and optionally enter dedicated scan and exclude folders. If left empty, the current download folders and exclude folders are used. Click "Find similar" to scan, review candidate duplicate groups, and double-click a file row to reveal it. The app only reports results; it does not delete or move files automatically. Broken or unreadable images are counted as errors and the first errors are written to the log.

The scanner handles `.jpg`, `.jpeg`, `.png`, `.webp`, `.bmp`, and `.gif`; animated GIF/WebP files use the first frame. For each image it stores file size, modified time, resolution, `sha256`, `pHash`, and `dHash`. The index is saved at:

```text
.pixiv-pbd-manager/image_index.json
```

Matching rules:

- Same `sha256`: exact duplicate.
- `pHash <= 6` and `dHash <= 10`: highly similar.
- `pHash <= 10` and `dHash <= 14`: possibly similar.

CLI examples:

```powershell
python -m pixiv_pbd_manager similar "C:\PixivLibrary"
python -m pixiv_pbd_manager similar "C:\PixivLibrary" --threshold possible --output similar_report.csv
```

## Pixiv Cookie & Privacy Risks

Downloading restricted (R-18) artworks requires a Pixiv session cookie (typically `PHPSESSID`), entered in the GUI's "Pixiv login" panel or via the CLI's `--pixiv-cookie` flag. The account must also have R-18 viewing enabled in Pixiv settings, otherwise restricted works will not appear in the `/profile/all` listing even with a valid cookie.

⚠️ **The cookie is as powerful as your password**. Please read the risks below before using it.

### Explicit consent is required before using a cookie

To prevent accidental misuse, cookie functionality is gated behind an explicit acceptance of the risk disclaimer:

- **GUI**: tick the "I have read and accept the cookie risk disclaimer" checkbox. The first time you tick it a modal disclaimer pops up and you must click "I accept" before the cookie input field becomes editable. Un-ticking the checkbox clears the locally stored cookie.
- **CLI**: when using `--pixiv-cookie` you must also pass `--accept-cookie-risk` once. The command refuses to run otherwise. Acceptance made in the GUI is reused by the CLI and vice versa.

The acceptance record is stored in `.pixiv-pbd-manager/consent.json`. Deleting that file is equivalent to revoking consent, and you will be asked again the next time you try to use a cookie.

### What the cookie can do

Anyone holding a valid `PHPSESSID` can — without your password:

- Read all of your private bookmarks, messages, purchase history, and follow list
- Like, follow, comment, post or delete artworks, and change account info on your behalf
- Operate Pixiv Booth / Fanbox purchases and patronage

Pixiv's 2FA only triggers when logging in with the password; **it does not protect an already-active session**.

### How the app stores it

- **Windows**: encrypted via [DPAPI](https://learn.microsoft.com/en-us/windows/win32/seccrypto/cryptoapi-cryptography-and-data-protection-api) into `.pixiv-pbd-manager/cookie.bin`. **Only the current Windows user** can decrypt it; copies in backups or other accounts cannot.
- **Non-Windows**: plain text in `.pixiv-pbd-manager/cookie.txt`, with `0600` permissions, relying on OS-level protection.
- It is no longer written to `gui_settings.json`, so it does not get synced into Git or cloud drives.
- `.pixiv-pbd-manager/` is already in the repository's `.gitignore`.

### Network-level trade-offs

- Cookies are sent only to `*.pixiv.net`. Image downloads from `i.pximg.net` **never include the cookie**, so the session is not leaked to the CDN.
- HTTP requests use a `User-Agent` matching current Chrome, reducing the chance of being flagged as a scripted client.
- Even so, high-frequency requests to `/ajax/illust/*/pages` and `/ajax/user/*/profile/all` may trigger rate-limits or CAPTCHA; in severe cases the account could be suspended. This violates Pixiv's terms of service, so use the tool moderately and configure `--delay` / `--resolve-delay` sensibly.

### Where the cookie could still leak

DPAPI is not a silver bullet. The cookie can still be exposed when:

- Your Windows user account itself is compromised (DPAPI decrypts cleanly in that user's context)
- The project folder is synced via OneDrive / Dropbox / etc. — the encrypted blob is decryptable by the same user, which is an unnecessary exposure surface
- A forced password reset invalidates the DPAPI master key — the stored cookie becomes garbage and must be re-entered
- Browser extensions, clipboard monitors, or screen recorders capture the plaintext cookie while pasting

### Recommendations

1. **Use a dedicated Pixiv account** for this tool, with R-18 enabled but no important data attached.
2. **Revoke the session when done** — log into Pixiv on the web and end the session manually.
3. **Do not place the project folder in a cloud-sync path** (OneDrive / Dropbox / etc.).
4. **If you suspect a leak, revoke immediately** — logging out of all sessions on Pixiv invalidates every existing cookie.

## Common Commands

```powershell
# Scan existing downloads and save artist IDs
python -m pixiv_pbd_manager scan "C:\PixivDownloads"

# Scan legacy folders and resolve Pixiv artist IDs from artwork IDs
python -m pixiv_pbd_manager scan "C:\PixivLibrary" --resolve-online

# Enable fuzzy artist-name search for manual folders like illus-artist-tag
python -m pixiv_pbd_manager scan "C:\PixivLibrary" --resolve-online --fuzzy-search

# Exclude subfolders while scanning; --exclude can be repeated
python -m pixiv_pbd_manager scan "C:\PixivLibrary" --exclude "C:\PixivLibrary\anime"

# Check whether recorded artists have new artworks
python -m pixiv_pbd_manager check

# Before checking updates, rescan each artist save path recursively
python -m pixiv_pbd_manager check --scan-local

# Check only the newest 2 artwork pages per artist
python -m pixiv_pbd_manager check --max-pages 2

# Check only specified artists
python -m pixiv_pbd_manager check 123456 789012

# Download newly detected artworks
python -m pixiv_pbd_manager download

# Save R-18/R-18G new works into an [R-18&R-18G] subfolder
python -m pixiv_pbd_manager download --separate-r18

# Download updates for specified artists
python -m pixiv_pbd_manager download 123456 789012

# Use a fallback output folder when save paths are missing
python -m pixiv_pbd_manager download --output-root "C:\PixivDownloads"

# Use strict SSL verification without fallback retry
python -m pixiv_pbd_manager scan "C:\PixivLibrary" --resolve-online --no-ssl-fallback

# Watch folders while PBD is downloading
python -m pixiv_pbd_manager watch "C:\PixivDownloads" --interval 30

# Find similar images and export a CSV report
python -m pixiv_pbd_manager similar "C:\PixivLibrary" --output similar_report.csv

# Manually add an artist
python -m pixiv_pbd_manager add 123456 --name "artist name"

# Open all recorded artist artwork pages for PBD
python -m pixiv_pbd_manager open

# Open only specified artists
python -m pixiv_pbd_manager open 123456 789012

# Export artist artwork-page URLs
python -m pixiv_pbd_manager export --format urls --output pbd_update_urls.txt
```

## Database Location

Default database path:

```text
.pixiv-pbd-manager/artists.json
```

To store it elsewhere, add `--db`:

```powershell
python -m pixiv_pbd_manager --help
python -m pixiv_pbd_manager scan --db "C:\PixivData\pixiv_artists.json" "C:\PixivDownloads"
```

## Use A Specific Browser

If your default browser is not the one with PBD installed, specify the browser executable:

```powershell
python -m pixiv_pbd_manager open --browser "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

If PBD is installed in a separate Chrome/Edge user data directory:

```powershell
python -m pixiv_pbd_manager open --browser "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir "C:\PixivBrowserProfile"
```

## Recognition Rules

The scanner first tries to identify artists from folder names, including:

```text
Artist-123456
Artist (123456)
[123456] Artist
123456 - Artist
```

Then it tries file names:

```text
98765432_user_id_123456_title.jpg
98765432_uid-123456_title.png
98765432_member_id=123456_title.webp
```

If old files contain only artwork IDs and no artist IDs, the tool cannot reliably infer artists offline. Change your PBD naming rule to include `{user_id}` so newly downloaded files become automatically recognizable.
