# Pixiv PBD Manager

[English README](README.en.md)

一个本地 Pixiv 下载管理器。它可以扫描已有图片库，记录 Pixiv 作者 ID、作者名、作品 ID 和每个作者的保存路径；之后你可以检查作者更新，并选择用 Powerful Pixiv Downloader 打开页面下载，或使用软件内置的直接下载器自动下载新作品。

## 工作方式

1. 扫描已有下载目录，识别作者、作品和保存路径。
2. 保存作者 ID、作者名、已见过作品 ID、可下载新作品 ID。
3. 检查更新时，逐个作者查询 Pixiv 是否有本地还没有保存的新作品。
4. 你可以打开作者作品页交给 PBD 下载，也可以使用“直接下载更新”自动下载。
5. 下载后再次扫描，数据库会更新为最新状态。

## 推荐 PBD 命名规则

建议在 Powerful Pixiv Downloader 的命名规则中包含作者 ID，例如：

```text
pixiv/{user}-{user_id}/{id}-{title}
```

这样扫描器可以直接从 `作者名-作者ID` 文件夹识别作者。工具也会尝试从文件名中的 `uid`、`user_id`、`member_id`、`artist_id` 等字段识别作者 ID。

## 快速开始

在本目录运行：

```powershell
python -m pixiv_pbd_manager gui
python -m pixiv_pbd_manager scan "D:\Downloads\pixiv"
python -m pixiv_pbd_manager list
python -m pixiv_pbd_manager open --limit 10
```

Windows 下也可以双击 [launch_gui.bat](launch_gui.bat) 启动。

## GUI 界面

启动桌面界面：

```powershell
python -m pixiv_pbd_manager gui
```

主要功能：

- 选择数据库位置。
- 添加一个或多个下载目录。
- 添加排除目录，扫描时跳过这些文件夹。
- 扫描下载目录并写入作者库。
- 开启定时监控，边下载边自动识别新作者和新作品。
- 在线解析只有作者名、没有作者 ID 的 Pixiv 文件夹。
- 可选开启作者名模糊搜索，适合 `illus-作者名-风格标签` 这类手动目录。
- 检查已记录作者是否有 Pixiv 新作品，并在“可下载”列显示数量。
- 直接下载“可下载”列里的新作品，无需手动点击 PBD。
- 表格显示扫描到的艺术家保存路径。
- 通过菜单栏 "设置 → 语言" 切换中文 / English，选择会自动保存。
- 通过 "设置 → 偏好设置..." 配置浏览器、扫描进阶选项、SSL 兼容、打开间隔/上限等不常用项。
- 查看、筛选、手动添加作者。
- 右键作者可以手动修改 Pixiv 作者 ID，修改后会尝试自动更新作者名。
- 右键作者可以手动修改保存路径。
- 点击表格第一列的蓝色勾选框可以勾选多个作者，也可以用“全选 / 取消全选”批量切换。
- 检查更新、打开有更新、直接下载更新会优先处理勾选作者；没有勾选时才使用当前高亮选中的行。
- 后台扫描、检查或下载运行时，仍然可以双击作者行打开该作者的浏览器页面；双击只打开被点击的作者，不受勾选列表影响。
- 导出或复制作者作品页 URL。

## 浏览器设置提醒

如果默认浏览器不是安装了 Powerful Pixiv Downloader 的浏览器，可以通过菜单 “设置 → 偏好设置...” 在”浏览器”区指定 Chrome/Edge 的 exe 路径和用户数据目录。

“浏览器用户数据目录”不要选择图片下载目录。Chrome/Edge 会在用户数据目录里创建 `Default`、`Safe Browsing`、`ShaderCache`、`Webstore Downloads` 等浏览器配置文件夹。GUI 会阻止把它设在下载目录内部；不确定时保持为空即可使用系统默认浏览器配置。

## 旧目录识别

如果旧目录像这样：

```text
D:\My_files\Drawings\参考图\96YOTTEA's illustrations／manga - pixiv\100187254_p0.jpg
```

这种文件夹本身只有作者名，没有 Pixiv 作者 ID。GUI 默认会勾选“在线解析无 ID 的 Pixiv 文件夹”，扫描时会用文件名里的作品 ID 请求 Pixiv，解析出作者 ID 后再写入数据库。离线扫描只能识别到这些“无 ID 文件夹”，不能生成可打开的作者更新页。

如果旧目录像这样：

```text
D:\My_files\Drawings\参考图\illus-一条レイ-赛璐璐-contrast color-dot\sample.jpg
```

这里的 `一条レイ` 会被当作候选作者名。勾选“模糊搜索作者名”后，软件会在线搜索 Pixiv 用户并尝试匹配作者 ID。因为手写名称可能不准确，这个功能默认关闭；建议先用较高匹配阈值试扫一小部分目录，确认结果后再大规模使用。

## SSL 证书兼容

如果 Python 环境遇到 `CERTIFICATE_VERIFY_FAILED`，GUI 默认会在证书校验失败时自动重试一次。命令行也默认启用这个兼容行为；如果想严格校验证书，可以添加 `--no-ssl-fallback`。

## 直接自动下载

GUI 中先点“检查更新”，确认表格“可下载”列出现数量后，可以点“直接下载更新”。如果先勾选了一些作者，只会下载勾选作者的新作品；如果没有勾选，会下载所有有更新的作者。

直接下载不是通过 Powerful Pixiv Downloader 完成，而是软件自己的下载器。它会先从数据库里读取“检查更新”得到的新作品 ID，然后请求 Pixiv 的作品分页接口：

```text
https://www.pixiv.net/ajax/illust/{work_id}/pages
```

软件会从返回结果里取每一页的 `urls.original` 原图地址，再用 Python 下载文件。请求 Pixiv 接口时会带 `Referer`、浏览器风格 `User-Agent` 和可选 Pixiv Cookie；从 `i.pximg.net` 下载图片时**只带 Referer，不带 Cookie**，避免把会话泄露给图片 CDN。

直接下载器会保存到数据库记录的艺术家保存路径。文件名使用：

```text
作品ID_p页码.扩展名
```

例如：

```text
12345678_p0.jpg
12345678_p1.png
```

如果某个作者没有保存路径，命令行可以用 `--output-root` 指定兜底目录。GUI 里建议先扫描一遍已有目录，让软件记录保存路径。

注意：直接下载器不使用 PBD 的命名规则和过滤器。公开作品通常可以直接下载；登录、年龄限制或不可见作品可能需要提供 Pixiv cookie。

## Pixiv Cookie 与隐私风险

直接下载限制级 (R-18) 作品需要在 GUI"Pixiv 登录"区或 CLI 的 `--pixiv-cookie` 参数提供 Pixiv 会话 Cookie（通常是 `PHPSESSID`）。账号还必须在 Pixiv 设置里开启 R-18 浏览，否则即便有 cookie，作品也不会出现在 `/profile/all` 列表中。

⚠️ **Cookie 等同于密码**。请认真阅读以下风险后再使用。

### 必须先同意免责声明才能使用 Cookie

为防止误用，本工具要求显式同意 Cookie 使用风险声明后才会启用 Cookie：

- **GUI**：勾选"我已阅读并同意 Cookie 使用风险声明"复选框。首次勾选会弹出免责声明，必须点击"我同意"才会启用 Cookie 输入框；取消勾选时会清除本地已保存的 Cookie。
- **CLI**：使用 `--pixiv-cookie` 时必须同时附带 `--accept-cookie-risk`（仅首次）。否则命令会直接拒绝执行。在 GUI 中已同意过的，CLI 也会复用该同意记录。

同意记录写在 `.pixiv-pbd-manager/consent.json` 中。删除该文件等同于撤回同意，下次使用 Cookie 时会被再次询问。

### 这个 Cookie 能做什么

只要持有有效的 `PHPSESSID`，无需密码即可：

- 查看你的所有私密书签、私信、购买记录、关注列表
- 以你的身份点赞、关注、评论、发作品、删作品、改账号信息
- 操作 Pixiv Booth / Fanbox 的购买与赞助

Pixiv 的二次验证 (2FA) 只在用密码新登录时触发，**不会保护已经登录的活动会话**。

### 软件如何保存它

- **Windows**：通过 [DPAPI](https://learn.microsoft.com/zh-cn/windows/win32/seccrypto/cryptoapi-cryptography-and-data-protection-api) 加密为 `.pixiv-pbd-manager/cookie.bin`，**只有当前 Windows 用户**能解密；其他系统账号、备份盘里的同份文件无法解密。
- **非 Windows**：以纯文本保存到 `.pixiv-pbd-manager/cookie.txt`，权限置为 `0600`，依赖 OS 权限保护。
- 不会写入 `gui_settings.json`，避免被一起同步到云盘 / Git。
- `.pixiv-pbd-manager/` 已在仓库 `.gitignore` 中。

### 网络层做了什么取舍

- 仅向 `*.pixiv.net` 发送 Cookie；下载图片走 `i.pximg.net`，**不会带 Cookie**，避免把会话泄露给图片 CDN。
- HTTP 请求使用与最新 Chrome 一致的 `User-Agent`，降低被识别为脚本客户端的概率。
- 即便如此，高频请求 `/ajax/illust/*/pages`、`/ajax/user/*/profile/all` 仍可能触发 rate limit 或人机验证；严重时账号可能被冻结。这违反 Pixiv 服务条款，请节制使用、合理设置 `--delay` 与 `--resolve-delay`。

### 风险仍然存在的情况

即使有 DPAPI 加密，下列情况下 Cookie 仍可能泄露：

- 你的 Windows 账号本身被入侵（DPAPI 在该用户上下文内可正常解密）
- 项目目录被同步到云盘（OneDrive / Dropbox / 坚果云等）：加密 blob 同账号能解，仍是多余暴露面
- Windows 强制重置密码导致 DPAPI master key 失效：本地存的 cookie 会变成无法解密的垃圾数据，需要重新粘贴
- 浏览器扩展、剪贴板监视、屏幕录像软件可能在粘贴瞬间截获明文 Cookie

### 推荐做法

1. **用一个专门跑本工具的小号**，开启 R-18 但不放任何重要数据；即便泄露，损失可控。
2. **用完手动注销**：在 Pixiv 网页设置里手动注销该 session。
3. **不要把项目目录放在云盘同步路径下**。
4. **怀疑泄露立即注销所有 session**：Pixiv 网页登录后注销所有会话即可作废全部 cookie。

## 常用命令

```powershell
# 扫描已有下载，保存作者 ID
python -m pixiv_pbd_manager scan "D:\Downloads\pixiv"

# 扫描旧目录，并用作品 ID 在线解析 Pixiv 作者 ID
python -m pixiv_pbd_manager scan "D:\My_files\Drawings\参考图" --resolve-online

# 开启作者名模糊搜索，适合 illus-作者名-标签 这类手动目录
python -m pixiv_pbd_manager scan "D:\My_files\Drawings\参考图" --resolve-online --fuzzy-search

# 扫描时排除某些子目录；--exclude 可以重复使用
python -m pixiv_pbd_manager scan "D:\My_files\Drawings\参考图" --exclude "D:\My_files\Drawings\参考图\anime"

# 检查已记录作者是否有新作品
python -m pixiv_pbd_manager check

# 只检查指定作者
python -m pixiv_pbd_manager check 123456 789012

# 下载检查出的新作品
python -m pixiv_pbd_manager download

# 下载指定作者的新作品
python -m pixiv_pbd_manager download 123456 789012

# 没有保存路径时指定兜底目录
python -m pixiv_pbd_manager download --output-root "D:\Downloads\pixiv"

# 严格 SSL 证书校验，不使用兼容重试
python -m pixiv_pbd_manager scan "D:\My_files\Drawings\参考图" --resolve-online --no-ssl-fallback

# PBD 正在下载时持续监控目录
python -m pixiv_pbd_manager watch "D:\Downloads\pixiv" --interval 30

# 手动添加作者
python -m pixiv_pbd_manager add 123456 --name "artist name"

# 打开全部已记录作者的作品页，让 PBD 接管下载
python -m pixiv_pbd_manager open

# 只打开指定作者
python -m pixiv_pbd_manager open 123456 789012

# 导出作者作品页 URL
python -m pixiv_pbd_manager export --format urls --output pbd_update_urls.txt
```

## 数据库位置

默认数据库位置：

```text
.pixiv-pbd-manager/artists.json
```

如果想放到别处，给命令加 `--db`：

```powershell
python -m pixiv_pbd_manager --help
python -m pixiv_pbd_manager scan --db "D:\Downloads\pixiv_artists.json" "D:\Downloads\pixiv"
```

## 使用指定浏览器

如果默认浏览器不是安装了 PBD 的那个，可以指定浏览器可执行文件：

```powershell
python -m pixiv_pbd_manager open --browser "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

如果 PBD 装在某个独立 Chrome/Edge 用户数据目录里：

```powershell
python -m pixiv_pbd_manager open --browser "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir "D:\chrome-pixiv-profile"
```

## 识别规则

优先从文件夹名识别作者，适合这些形式：

```text
Artist-123456
Artist (123456)
[123456] Artist
123456 - Artist
```

然后从文件名识别：

```text
98765432_user_id_123456_title.jpg
98765432_uid-123456_title.png
98765432_member_id=123456_title.webp
```

如果旧文件完全没有作者 ID，只保留作品 ID，工具无法离线可靠推断作者。建议先把 PBD 命名规则改成包含 `{user_id}`，之后新下载的文件会自动可识别。
