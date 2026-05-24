# Pixiv PBD Manager

[中文 README](README.md)

Pixiv PBD Manager is a local Pixiv image library manager. It scans existing downloads, records artists and save paths, checks for updates, downloads newly found artworks, and helps find visually similar images across different file names, formats, and resolutions.

This README is written for people who just want to use the app. Development notes, CLI details, and implementation notes live in [docs/en](docs/en/).

## Download And Install

Windows x64 installers are available:

1. Open [Releases](https://github.com/J-FPV/Pixiv-PBD-Manager/releases).
2. Download the latest `Pixiv.PBD.Manager_*_x64-setup.exe`.
3. Run the installer, then start Pixiv PBD Manager from the Start Menu.

Most users should use the `setup.exe`. An `msi` is also published for environments that prefer MSI installers.

The installer includes the Python backend and dependencies. You do not need to install Python, Node.js, or Rust just to use the app.

## What It Does

- Scans Pixiv image folders and identifies artists, artwork IDs, and save paths.
- Tracks each artist's Pixiv ID, display name, known artworks, and newly available artworks.
- Checks one or more artists for updates and shows which artist has new files.
- Downloads newly detected artworks directly, or opens Pixiv pages for Powerful Pixiv Downloader.
- Helps resolve old folders that contain artist names but no artist IDs.
- Skips folders you add to the exclude list.
- Finds similar images across different file names, formats, and resolutions.
- Supports thumbnail previews and difference-image comparison.
- Supports Chinese / English UI switching.

## Recommended Workflow

1. Start the app.
2. Add your image library folders in Settings.
3. Add exclude folders if needed.
4. Go to Artists and click Scan.
5. Review and apply the scan preview.
6. Click Check updates.
7. Select artists and click Download updated, or click Open selected and use Powerful Pixiv Downloader in the browser.

## First-Time Settings

Open Settings and check these fields first:

- **Download folders**: your Pixiv image library folders.
- **Exclude folders**: folders that should not be scanned.
- **Similar image folders and excludes**: Similar Images has its own scan folders and exclude folders, saved separately.
- **Database path**: the installed app defaults to `%APPDATA%\PixivPbdManager\.pixiv-pbd-manager\artists.json`; most users can leave it unchanged.
- **Browser path**: set this if your default browser is not the one with Powerful Pixiv Downloader installed.
- **Browser user data directory**: do not set this to your image library. Chrome / Edge will create folders such as `Default`, `ShaderCache`, `Safe Browsing`, and `Webstore Downloads`.
- **Pixiv Cookie**: only needed for login-only or restricted artworks. A cookie is a login credential, so read the in-app warning before using it.

## Recommended PBD Naming Rule

If you still use Powerful Pixiv Downloader, include the Pixiv artist ID in folder or file names. Recommended rule:

```text
pixiv/{user}-{user_id}/{id}-{title}
```

This lets the app identify artists directly from folder names. Old folders that only contain artist names can still use online resolution or fuzzy search, but accuracy depends on file names and Pixiv search results.

## Downloading Updates

"Download updated" uses the app's built-in downloader, not PBD. It downloads artworks found by "Check updates" and saves them to each artist's recorded save path.

Typical flow:

1. Scan your local library first so save paths are known.
2. Click Check updates.
3. When the New column shows counts, click Download updated.
4. If artists are selected, only those artists are downloaded. If none are selected, all artists with updates are downloaded.

If you prefer PBD naming rules, filters, or extension behavior, use Open selected and let PBD handle the browser pages.

## Similar Images

Open Similar Images, choose scan folders, and click Find similar images. Results are grouped as possible duplicates and include thumbnails for comparison.

Notes:

- The app only reports results; it does not delete or move files.
- Different resolutions, light compression, and different image formats can still match.
- You can skip comparisons between Pixiv split pages such as `{pid}_p0` and `{pid}_p1`.
- The preview window lets you switch between images in the group and view a generated difference image.

## Common Questions

### Why did scanning miss an artist?

Check whether the folder or file name contains the Pixiv artist ID. The recommended PBD naming rule is the most reliable option.

If old folders only contain artist names, enable online resolution. If they were manually named, try fuzzy search. Unrecognized folders appear in the Unmatched tab, where you can assign an artist ID manually.

### Why did browser files appear in my image library?

Folders such as `Default`, `Safe Browsing`, `ShaderCache`, `Webstore Downloads`, and `Crashpad` are Chrome / Edge profile files. They usually appear when the browser user data directory was accidentally set to your image library.

Close the app and browser, move the browser user data directory outside the image library, and only then clean up files you have confirmed are browser profile files.

### Do I need to enter a cookie?

No. Public artworks usually do not need one. Login-only, age-restricted, or otherwise restricted artworks may require a Pixiv cookie.

If you use a cookie, consider a dedicated Pixiv account and revoke the session from Pixiv when done.

### How do I run from source?

Running from source is mainly for development:

```powershell
pip install -e .
cd desktop
npm install
npm run tauri:dev
```

Source runs require Python, Node.js/npm, and Rust/Cargo. For normal use, install the Release build instead.

## More Documentation

- [Advanced usage](docs/en/advanced-usage.md): legacy folder recognition, direct download details, similar image rules, cookie risks, and CLI commands.
- [Development notes](docs/en/development.md): Tauri setup, project structure, tests, packaging, and release workflow.
- [Manual test checklist](docs/zh/manual-test-checklist.md): GUI regression checklist, currently maintained in Chinese.
