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
python -m pixiv_pbd_manager gui
python -m pixiv_pbd_manager scan "D:\Downloads\pixiv"
python -m pixiv_pbd_manager list
python -m pixiv_pbd_manager open --limit 10
```

On Windows, you can also double-click [launch_gui.bat](launch_gui.bat), or build a single-file .exe and double-click that (see below).

## Building a Standalone .exe

If you would rather not run the GUI from source every time, you can package it into a single-file Windows executable:

```powershell
pip install pyinstaller          # or: pip install -e .[build]
python build_exe.py
```

The resulting `dist/PixivPbdManager.exe` is about 10 MB and ships without a console window. Move it together with `.pixiv-pbd-manager/` (which holds the database, cookie, and consent files) to any location and it just works — when the exe starts it changes the working directory to its own folder, so all data files always end up next to the exe.

To rebuild, rerun `python build_exe.py`; the script automatically cleans the previous `build/`, `dist/`, and `.spec` artifacts before building.

## GUI

Start the desktop GUI:

```powershell
python -m pixiv_pbd_manager gui
```

Main GUI features:

- Choose the database location.
- Add one or more download folders.
- Add excluded folders so scans skip them.
- Scan download folders and write artists into the database.
- Start folder watching to detect new artists and artworks while downloading.
- Resolve Pixiv folders that have artist names but no artist IDs.
- Optionally enable fuzzy artist-name search for manual folders like `illus-artist-style-tag`.
- Check whether recorded artists have new Pixiv artworks and show the count in the "New" column.
- Directly download artworks listed as new without manually clicking PBD.
- Show each detected artist's save path in the table.
- Switch between Chinese and English from the menu "Settings → Language"; the choice is saved automatically.
- Use "Settings → Preferences..." to configure the browser, advanced scan options, SSL fallback, and open delay/limit — the less-frequently changed settings.
- View, filter, and manually add artists.
- Right-click an artist to edit the Pixiv artist ID; the app will try to update the artist name automatically.
- Right-click an artist to edit the save path.
- Click the blue checkbox in the first table column to pick multiple artists, or use "Select all / Clear all".
- Update checks, opening updated artists, and direct downloads prioritize checked artists; if none are checked, the highlighted rows are used.
- While a background scan, check, or download is running, you can still double-click an artist row to open that artist's browser page. Double-click opens only the clicked artist and ignores the checked list.
- Export or copy artist artwork-page URLs.

## Browser Profile Warning

If your default browser is not the one with Powerful Pixiv Downloader installed, open the menu "Settings → Preferences..." and set the Chrome/Edge executable path and user data directory in the "Browser" section.

Do not set "browser user data" to your image download folder. Chrome/Edge creates profile folders such as `Default`, `Safe Browsing`, `ShaderCache`, and `Webstore Downloads` there. The GUI blocks user-data folders inside download roots; if unsure, leave it blank to use the system default browser profile.

## Legacy Folder Recognition

If an old folder looks like this:

```text
D:\My_files\Drawings\参考图\96YOTTEA's illustrations／manga - pixiv\100187254_p0.jpg
```

This folder has an artist name but no Pixiv artist ID. The GUI enables online resolution for no-ID Pixiv folders by default. During scanning, it uses artwork IDs from file names to query Pixiv, resolves the artist ID, then writes it into the database. Offline scanning can only mark these as name-only folders and cannot generate usable artist update pages.

If an old folder looks like this:

```text
D:\My_files\Drawings\参考图\illus-一条レイ-赛璐璐-contrast color-dot\sample.jpg
```

Here, `一条レイ` is treated as a candidate artist name. When "Fuzzy-search artist names" is enabled, the app searches Pixiv users online and tries to match the artist ID. Because manually typed names may be inaccurate, this option is disabled by default; try a small folder set with a higher score threshold before scanning a large library.

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

If an artist has no save path, the CLI can use `--output-root` as a fallback directory. In the GUI, it is best to scan existing folders first so the app can record save paths.

Note: The direct downloader does not use PBD naming rules or filters. Public artworks usually download directly; login-only, age-restricted, or hidden artworks may require Pixiv cookies.

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
python -m pixiv_pbd_manager scan "D:\Downloads\pixiv"

# Scan legacy folders and resolve Pixiv artist IDs from artwork IDs
python -m pixiv_pbd_manager scan "D:\My_files\Drawings\参考图" --resolve-online

# Enable fuzzy artist-name search for manual folders like illus-artist-tag
python -m pixiv_pbd_manager scan "D:\My_files\Drawings\参考图" --resolve-online --fuzzy-search

# Exclude subfolders while scanning; --exclude can be repeated
python -m pixiv_pbd_manager scan "D:\My_files\Drawings\参考图" --exclude "D:\My_files\Drawings\参考图\anime"

# Check whether recorded artists have new artworks
python -m pixiv_pbd_manager check

# Check only specified artists
python -m pixiv_pbd_manager check 123456 789012

# Download newly detected artworks
python -m pixiv_pbd_manager download

# Download updates for specified artists
python -m pixiv_pbd_manager download 123456 789012

# Use a fallback output folder when save paths are missing
python -m pixiv_pbd_manager download --output-root "D:\Downloads\pixiv"

# Use strict SSL verification without fallback retry
python -m pixiv_pbd_manager scan "D:\My_files\Drawings\参考图" --resolve-online --no-ssl-fallback

# Watch folders while PBD is downloading
python -m pixiv_pbd_manager watch "D:\Downloads\pixiv" --interval 30

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
python -m pixiv_pbd_manager scan --db "D:\Downloads\pixiv_artists.json" "D:\Downloads\pixiv"
```

## Use A Specific Browser

If your default browser is not the one with PBD installed, specify the browser executable:

```powershell
python -m pixiv_pbd_manager open --browser "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

If PBD is installed in a separate Chrome/Edge user data directory:

```powershell
python -m pixiv_pbd_manager open --browser "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir "D:\chrome-pixiv-profile"
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
