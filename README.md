# Pixiv PBD Manager

[English-only README](README.en.md)

中文：如果只想看英文版，打开 [README.en.md](README.en.md)。当前文件是中英对照版。

English: For an English-only version, open [README.en.md](README.en.md). This file is the bilingual version.

中文：一个本地 Pixiv 下载管理器，既可以配合浏览器里的 Powerful Pixiv Downloader 使用，也可以直接自动下载检查出的新作品。它会扫描已有图片目录，记录 Pixiv 作者 ID、作者名、作品 ID 和每个作者的保存路径，方便以后只下载作者更新。

English: A local Pixiv download manager that can work with the browser extension Powerful Pixiv Downloader, and can also directly download newly detected artworks. It scans existing image folders, records Pixiv artist IDs, artist names, artwork IDs, and per-artist save paths so future updates are easier to fetch.

## 工作方式 / How It Works

中文：

1. 扫描已有下载目录，识别作者、作品和保存路径。
2. 保存作者 ID、作者名、已见过作品 ID、可下载新作品 ID。
3. 检查更新时，逐个作者查询 Pixiv 是否有用户本地还没有保存的新作品。
4. 你可以打开作者作品页交给 PBD 下载，也可以用软件的“直接下载更新”自动下载。
5. 下载后再次扫描，数据库会更新为最新状态。

English:

1. Scan existing download folders to identify artists, artworks, and save paths.
2. Store artist IDs, artist names, known artwork IDs, and newly available artwork IDs.
3. Check Pixiv for each recorded artist to find artworks not yet saved locally.
4. Open artist pages for PBD, or use "Download updated" to download updates directly.
5. Scan again after downloading to refresh the local database.

## 推荐 PBD 命名规则 / Recommended PBD Naming Rule

中文：建议在 Powerful Pixiv Downloader 的命名规则中包含作者 ID，例如：

English: It is recommended to include the artist ID in Powerful Pixiv Downloader's naming rule, for example:

```text
pixiv/{user}-{user_id}/{id}-{title}
```

中文：这样扫描器可以直接从 `作者名-作者ID` 文件夹识别作者。工具也会尝试从文件名中的 `uid`、`user_id`、`member_id`、`artist_id` 等字段识别。

English: This lets the scanner identify artists directly from folders like `Artist-ArtistID`. The tool also tries to read `uid`, `user_id`, `member_id`, `artist_id`, and similar fields from file names.

## 快速开始 / Quick Start

中文：在本目录运行：

English: Run these commands from this folder:

```powershell
python -m pixiv_pbd_manager gui
python -m pixiv_pbd_manager scan "D:\Downloads\pixiv"
python -m pixiv_pbd_manager list
python -m pixiv_pbd_manager open --limit 10
```

Windows 下也可以双击 [launch_gui.bat](launch_gui.bat) 启动。

On Windows, you can also double-click [launch_gui.bat](launch_gui.bat).

## GUI 界面 / GUI

中文：启动桌面界面：

English: Start the desktop GUI:

```powershell
python -m pixiv_pbd_manager gui
```

GUI 支持的主要操作 / Main GUI features:

- 中文：选择数据库位置。  
  English: Choose the database location.
- 中文：添加一个或多个下载目录。  
  English: Add one or more download folders.
- 中文：添加排除目录，扫描时直接跳过这些文件夹。  
  English: Add excluded folders so scans skip them.
- 中文：扫描下载目录并写入作者库。  
  English: Scan download folders and write artists into the database.
- 中文：开启定时监控，边下载边自动识别新作者和新作品。  
  English: Start folder watching to detect new artists and artworks while downloading.
- 中文：在线解析只有作者名、没有作者 ID 的 Pixiv 文件夹。  
  English: Resolve Pixiv folders that have artist names but no artist IDs.
- 中文：可选开启作者名模糊搜索，适合 `illus-作者名-风格标签` 这类手动目录。  
  English: Optionally enable fuzzy artist-name search for manual folders like `illus-artist-style-tag`.
- 中文：检查每个已记录作者是否有 Pixiv 新作品，并在“可下载”列显示数量。  
  English: Check whether recorded artists have new Pixiv artworks and show the count in the "New" column.
- 中文：直接下载“可下载”列里的新作品，无需手动点击 PBD。  
  English: Directly download artworks listed as new without manually clicking PBD.
- 中文：表格显示扫描到的艺术家保存路径。  
  English: Show each detected artist's save path in the table.
- 中文：右上角可切换中文 / English，选择会自动保存。  
  English: Switch between Chinese and English in the top-right corner; the choice is saved automatically.
- 中文：查看、筛选、手动添加作者。  
  English: View, filter, and manually add artists.
- 中文：右键作者可以手动修改 Pixiv 作者 ID，修改后会尝试自动更新作者名。  
  English: Right-click an artist to edit the Pixiv artist ID; the app will try to update the artist name automatically.
- 中文：右键作者可以手动修改保存路径。  
  English: Right-click an artist to edit the save path.
- 中文：点击表格第一列的蓝色勾选框可以勾选多个作者，也可以用“全选 / 取消全选”批量切换。  
  English: Click the blue checkbox in the first table column to pick multiple artists, or use "Select all / Clear all".
- 中文：检查更新、打开有更新、直接下载更新会优先处理勾选作者；没有勾选时才使用当前高亮选中的行。  
  English: Update checks, opening updated artists, and direct downloads prioritize checked artists; if none are checked, the highlighted rows are used.
- 中文：后台扫描、检查或下载运行时，仍然可以双击作者行打开该作者的浏览器页面；双击只打开被点击的作者，不受勾选列表影响。  
  English: While a background scan, check, or download is running, you can still double-click an artist row to open that artist's browser page; double-click opens only the clicked artist and ignores the checked list.
- 中文：导出或复制作者作品页 URL。  
  English: Export or copy artist artwork-page URLs.

## 浏览器设置提醒 / Browser Profile Warning

中文：如果默认浏览器不是安装了 Powerful Pixiv Downloader 的浏览器，可以在左侧“浏览器”区域指定 Chrome/Edge 的 exe 路径和用户数据目录。

English: If your default browser is not the one with Powerful Pixiv Downloader installed, set the Chrome/Edge executable path and user data directory in the left-side "Browser" section.

中文：“浏览器用户数据目录”不要选择图片下载目录。Chrome/Edge 会在用户数据目录里创建 `Default`、`Safe Browsing`、`ShaderCache`、`Webstore Downloads` 等浏览器配置文件夹。GUI 会阻止把它设在下载目录内部；不确定时保持为空即可使用系统默认浏览器配置。

English: Do not set "browser user data" to your image download folder. Chrome/Edge creates profile folders such as `Default`, `Safe Browsing`, `ShaderCache`, and `Webstore Downloads` there. The GUI blocks user-data folders inside download roots; if unsure, leave it blank to use the system default browser profile.

## 旧目录识别 / Legacy Folder Recognition

中文：如果旧目录像这样：

English: If an old folder looks like this:

```text
D:\My_files\Drawings\参考图\96YOTTEA's illustrations／manga - pixiv\100187254_p0.jpg
```

中文：这种文件夹本身只有作者名，没有 Pixiv 作者 ID。GUI 默认会勾选“在线解析无 ID 的 Pixiv 文件夹”，扫描时会用文件名里的作品 ID 请求 Pixiv，解析出作者 ID 后再写入数据库。离线扫描只能识别到这些“无 ID 文件夹”，不能生成可打开的作者更新页。

English: This folder has an artist name but no Pixiv artist ID. The GUI enables online resolution for no-ID Pixiv folders by default. During scanning, it uses artwork IDs from file names to query Pixiv, resolves the artist ID, then writes it into the database. Offline scanning can only mark these as name-only folders and cannot generate usable artist update pages.

中文：如果你的旧目录像这样：

English: If an old folder looks like this:

```text
D:\My_files\Drawings\参考图\illus-一条レイ-赛璐璐-contrast color-dot\sample.jpg
```

中文：这里的 `一条レイ` 会被当作候选作者名。勾选“模糊搜索作者名”后，软件会在线搜索 Pixiv 用户并尝试匹配作者 ID。因为手写名称可能不准确，这个功能默认关闭；建议先用较高匹配阈值试扫一小部分目录，确认结果后再大规模使用。

English: Here, `一条レイ` is treated as a candidate artist name. When "Fuzzy-search artist names" is enabled, the app searches Pixiv users online and tries to match the artist ID. Because manually typed names may be inaccurate, this option is disabled by default; try a small folder set with a higher score threshold before scanning a large library.

## SSL 证书兼容 / SSL Certificate Fallback

中文：如果 Python 环境遇到 `CERTIFICATE_VERIFY_FAILED`，GUI 默认会在证书校验失败时自动重试一次。命令行也默认启用这个兼容行为；如果想严格校验证书，可以添加 `--no-ssl-fallback`。

English: If your Python environment hits `CERTIFICATE_VERIFY_FAILED`, the GUI retries once with a compatibility fallback by default. The CLI also enables this fallback by default. Add `--no-ssl-fallback` if you want strict certificate verification.

## 直接自动下载 / Direct Automatic Download

中文：GUI 中先点“检查更新”，确认表格“可下载”列出现数量后，可以点“直接下载更新”。如果先勾选了一些作者，只会下载勾选作者的新作品；如果没有勾选，会下载所有有更新的作者。

English: In the GUI, click "Check updates" first. Once the "New" column shows counts, click "Download updated". If some artists are checked, only their new artworks are downloaded; if none are checked, all artists with updates are downloaded.

中文：直接下载不是通过 Powerful Pixiv Downloader 完成，而是软件自己的下载器。它会先从数据库里读取“检查更新”得到的新作品 ID，然后请求 Pixiv 的作品分页接口 `https://www.pixiv.net/ajax/illust/{work_id}/pages`，从返回结果里取每一页的 `urls.original` 原图地址，再用 Python 下载文件。下载请求会带上作品页 `Referer`、浏览器风格的 `User-Agent`，以及可选 Pixiv cookie。

English: Direct download does not use Powerful Pixiv Downloader. It uses the app's own downloader. The app reads new artwork IDs found by "Check updates", requests Pixiv's artwork pages API `https://www.pixiv.net/ajax/illust/{work_id}/pages`, extracts each page's `urls.original` image URL, then downloads the files with Python. Download requests include the artwork page `Referer`, a browser-like `User-Agent`, and an optional Pixiv cookie.

中文：直接下载器会保存到数据库记录的艺术家保存路径。文件名使用：

English: The direct downloader saves files to each artist's recorded save path. File names use:

```text
作品ID_p页码.扩展名
artworkID_pPage.extension
```

例如 / Example:

```text
12345678_p0.jpg
12345678_p1.png
```

中文：如果某个作者没有保存路径，命令行可以用 `--output-root` 指定兜底目录。GUI 里建议先扫描一遍已有目录，让软件记录保存路径。

English: If an artist has no save path, the CLI can use `--output-root` as a fallback directory. In the GUI, it is best to scan existing folders first so the app can record save paths.

中文：注意：直接下载器不使用 PBD 的命名规则和过滤器。它根据 Pixiv 的作品分页接口下载原图。公开作品通常可以直接下载；登录、年龄限制或不可见作品可能需要提供 Pixiv cookie。

English: Note: The direct downloader does not use PBD naming rules or filters. Public artworks usually download directly; login-only, age-restricted, or hidden artworks may require Pixiv cookies.

## 常用命令 / Common Commands

```powershell
# 扫描已有下载，保存作者 ID
# Scan existing downloads and save artist IDs
python -m pixiv_pbd_manager scan "D:\Downloads\pixiv"

# 扫描旧目录，并用作品 ID 在线解析 Pixiv 作者 ID
# Scan legacy folders and resolve Pixiv artist IDs from artwork IDs
python -m pixiv_pbd_manager scan "D:\My_files\Drawings\参考图" --resolve-online

# 开启作者名模糊搜索，适合 illus-作者名-标签 这类手动目录
# Enable fuzzy artist-name search for manual folders like illus-artist-tag
python -m pixiv_pbd_manager scan "D:\My_files\Drawings\参考图" --resolve-online --fuzzy-search

# 扫描时排除某些子目录；--exclude 可以重复使用
# Exclude subfolders while scanning; --exclude can be repeated
python -m pixiv_pbd_manager scan "D:\My_files\Drawings\参考图" --exclude "D:\My_files\Drawings\参考图\anime"

# 检查已记录作者是否有新作品
# Check whether recorded artists have new artworks
python -m pixiv_pbd_manager check

# 只检查指定作者
# Check only specified artists
python -m pixiv_pbd_manager check 123456 789012

# 下载检查出的新作品
# Download newly detected artworks
python -m pixiv_pbd_manager download

# 下载指定作者的新作品
# Download updates for specified artists
python -m pixiv_pbd_manager download 123456 789012

# 没有保存路径时指定兜底目录
# Use a fallback output folder when save paths are missing
python -m pixiv_pbd_manager download --output-root "D:\Downloads\pixiv"

# 严格 SSL 证书校验，不使用兼容重试
# Use strict SSL verification without fallback retry
python -m pixiv_pbd_manager scan "D:\My_files\Drawings\参考图" --resolve-online --no-ssl-fallback

# PBD 正在下载时持续监控目录
# Watch folders while PBD is downloading
python -m pixiv_pbd_manager watch "D:\Downloads\pixiv" --interval 30

# 手动添加作者
# Manually add an artist
python -m pixiv_pbd_manager add 123456 --name "artist name"

# 打开全部已记录作者的作品页，让 PBD 接管下载
# Open all recorded artist artwork pages for PBD
python -m pixiv_pbd_manager open

# 只打开指定作者
# Open only specified artists
python -m pixiv_pbd_manager open 123456 789012

# 导出作者作品页 URL
# Export artist artwork-page URLs
python -m pixiv_pbd_manager export --format urls --output pbd_update_urls.txt
```

## 数据库位置 / Database Location

默认数据库位置 / Default database path:

```text
.pixiv-pbd-manager/artists.json
```

中文：如果想放到别处，给命令加 `--db`：

English: To store it elsewhere, add `--db`:

```powershell
python -m pixiv_pbd_manager --help
python -m pixiv_pbd_manager scan --db "D:\Downloads\pixiv_artists.json" "D:\Downloads\pixiv"
```

## 使用指定浏览器 / Use A Specific Browser

中文：如果默认浏览器不是安装了 PBD 的那个，可以指定浏览器可执行文件：

English: If your default browser is not the one with PBD installed, specify the browser executable:

```powershell
python -m pixiv_pbd_manager open --browser "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

中文：如果 PBD 装在某个独立 Chrome/Edge 用户数据目录里：

English: If PBD is installed in a separate Chrome/Edge user data directory:

```powershell
python -m pixiv_pbd_manager open --browser "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir "D:\chrome-pixiv-profile"
```

## 识别规则 / Recognition Rules

中文：优先从文件夹名识别作者，适合这些形式：

English: The scanner first tries to identify artists from folder names, including:

```text
Artist-123456
Artist (123456)
[123456] Artist
123456 - Artist
```

中文：然后从文件名识别：

English: Then it tries file names:

```text
98765432_user_id_123456_title.jpg
98765432_uid-123456_title.png
98765432_member_id=123456_title.webp
```

中文：如果旧文件完全没有作者 ID，只保留作品 ID，工具无法离线可靠推断作者。建议先把 PBD 命名规则改成包含 `{user_id}`，之后新下载的文件会自动可识别。

English: If old files contain only artwork IDs and no artist IDs, the tool cannot reliably infer artists offline. Change your PBD naming rule to include `{user_id}` so newly downloaded files become automatically recognizable.
