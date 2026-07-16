# 高级使用说明

[English](../en/advanced-usage.md)

这份文档保存从 README 中移出的细节。普通使用者通常只需要看根目录的 README；当你需要理解识别规则、命令行、Cookie 风险或下载实现时，再看这里。

## 旧目录识别

最稳定的识别方式是让目录或文件名包含 Pixiv 艺术家 ID，例如：

```text
pixiv/{user}-{user_id}/{id}-{title}
```

扫描器会优先从文件夹名识别这些形式：

```text
ArtistName-123456
ArtistName (123456)
[123456] ArtistName
123456 - ArtistName
```

然后会尝试从文件名中读取常见字段：

```text
98765432_user_id_123456_title.jpg
98765432_uid-123456_title.png
98765432_member_id=123456_title.webp
```

当目录里有多个作品 ID 时，在线解析不会只取排序最前的一张。它会从较新、中间和较旧位置抽取有限数量的 PID，并以多数作者结果为准；单个已删除、受限或无法访问的作品不会让整个文件夹解析失败。这样对混合年代、首张作品失效或文件排序特殊的旧目录更可靠。

如果旧目录只有艺术家名、没有艺术家 ID，例如：

```text
C:\PixivLibrary\ArtistName's illustrations - pixiv\12345678_p0.jpg
```

GUI 可以使用文件名里的作品 ID 在线请求 Pixiv，解析出作者 ID 后写入数据库。离线扫描只能把这类目录列为“未识别”或“无 ID”候选，不能可靠生成可更新的艺术家记录。

如果旧目录是手动命名，例如：

```text
C:\PixivLibrary\illus-ArtistName-style-tag\12345678_p0.jpg
```

可以开启“模糊搜索作者名”。软件会在线搜索 Pixiv 用户并尝试匹配 ID。因为手写名字可能不准确，建议先用较高阈值和少量目录测试，确认结果可靠后再大范围使用。

## 直接自动下载

GUI 中先点击“检查更新”。当“可下载”列出现数量后，可以点击“下载更新”。

- 有勾选艺术家时，只下载勾选艺术家的新作品。
- 没有勾选艺术家时，下载所有有更新的艺术家。

直接下载不是通过 Powerful Pixiv Downloader 完成，而是软件自己的下载器。它会读取数据库中由“检查更新”得到的新作品 ID，请求 Pixiv 的作品分页接口：

```text
https://www.pixiv.net/ajax/illust/{work_id}/pages
```

软件从返回结果里读取每一页的 `urls.original` 原图地址，然后用 Python 下载文件。

请求 `*.pixiv.net` 时会带 `Referer`、浏览器风格 `User-Agent` 和可选 Pixiv Cookie；从 `i.pximg.net` 下载图片时只带 `Referer`，不带 Cookie，避免把会话暴露给图片 CDN。

文件默认保存到数据库记录的艺术家保存路径。直接下载器使用的文件名格式是：

```text
作品ID_p页码.扩展名
```

例如：

```text
12345678_p0.jpg
12345678_p1.png
```

如果某个艺术家没有保存路径，命令行可以用 `--output-root` 指定兜底目录。GUI 里建议先扫描已有目录，让软件记录保存路径。

注意：直接下载器不使用 PBD 的命名规则和过滤器。公开作品通常可以直接下载；登录可见、年龄限制或隐藏作品可能需要 Pixiv Cookie。

## 并行下载

设置里的“并行下载数”控制同时下载多少个作品（1–5，默认 1）。下载更新时会用一个线程池并行处理待下载作品：

- 数值越高下载越快，但向 Pixiv 发起的并发请求也越多，**越容易触发限流或人机验证**，建议保持 1–2。
- 右下角任务窗口里除了“总进度”条，还会为每个并行槽位单独显示一条进度条，分别对应当前各槽位正在下载的图片（文件名 + 字节进度 / 速度）。
- 上限为 5，前后端都会做钳制。

## R-18 / R-18G 子文件夹

设置里可以开启“限制级作品单独存入 `[R-18&R-18G]` 子文件夹”。开启后：

- 下载器会先查询作品的 `xRestrict` 标记。
- R-18 / R-18G 作品保存到该艺术家目录下的 `[R-18&R-18G]`。
- 普通作品仍保存在艺术家目录根部。
- 限制级作品下载失败时，日志会逐条显示具体作品 ID 和失败原因。

## 检查更新时扫描本地子文件夹

检查更新时，软件现在会自动读取每位艺术家保存路径根目录下已有的作品 ID，再和 Pixiv 远程列表比较。因此你手动下载图片并放进该艺术家的保存路径根目录后，下一次检查更新会把它视为已保存作品。

如果你把作品手动整理进子文件夹，可以开启“检查更新时递归扫描艺术家子文件夹”。开启后，软件还会读取该艺术家保存路径下的子文件夹，避免已经保存到子文件夹里的作品被误判为新作品。

也可以设置“检查更新页数”。`0` 表示检查全部作品；大于 `0` 时只检查每个艺术家主页最新的前 N 页，速度更快，但可能漏掉较旧的新增或补档。

## 相似图片检测规则

GUI 中打开“相似图片”页，可以单独填写扫描目录和排除目录。扫描目录留空时默认使用当前下载目录；相似图片排除目录是独立设置，会单独记住，不会自动套用普通扫描排除目录。损坏图片或无法读取的文件会计入错误，并在日志中显示前若干条。

支持格式：

```text
.jpg .jpeg .png .webp .bmp .gif
```

GIF / WebP 动图使用首帧。

每张图片会记录：

- 绝对路径
- 文件大小、修改时间
- 图片宽高
- `sha256`
- `pHash`
- `dHash`

索引默认保存到：

```text
.pixiv-pbd-manager/image_index.json
```

判断规则：

- `sha256` 相同：完全重复。
- `pHash <= 6` 且 `dHash <= 10`：高度相似。
- `pHash <= 10` 且 `dHash <= 14`：可能相似。

可以开启“不比较同一 Pixiv 作品的拆分页”。这样 `{pid}_p0`、`{pid}_p1`、`{pid}_p2` 这类同一作品不同页不会互相组成相似组。

### 安全清理与隔离区

扫描结果会按像素面积、文件大小、修改时间和路径稳定推荐保留版本：

- 完全重复：自动提出清理建议。
- 高度相似：只有宽高比足够接近时才提出建议。
- 可能相似：不预选，必须手动决定。

软件不会自动移动或删除图片。点击“清理所选”并确认后，文件会移动到用户指定的图库外隔离目录；每组至少保留一张。隔离区支持恢复和手动永久删除，恢复遇到同名目标时会跳过，绝不覆盖已有文件。

忽略分组和操作历史保存在 `.pixiv-pbd-manager/cleanup_state.json`，不会写入 `artists.json`，也不会被“重置所有设置”删除。每次隔离操作还会在隔离目录内创建独立任务目录及 UTF-8 `manifest.json`。永久删除没有自动过期机制，只能在隔离区手动执行并二次确认。

清理确认会分别列出本次保留项与隔离项。扫描结果顶部按“完全重复 / 高度相似 / 可能相似”统计分组数和预计释放空间；每组会说明推荐依据。隔离记录支持直接打开对应任务目录，失败项会保留错误原因，方便处理后重试。

扫描结果和隔离记录都使用分页，避免一次渲染大量文件。隔离记录可以调整每页数量；切页只改变显示，不会修改隔离状态。预览中的单图、并排和差异模式会先把图片完整适配到可用区域，再允许滚轮缩放和拖动平移。

## 图库索引与体检

图库索引正文保存在 `.pixiv-pbd-manager/library_index.json`，扫描时间、扫描/排除目录和根目录时间快照保存在 `library_index.meta.json`。索引超过 6 小时、目录配置变化或根目录内容变化时，桌面端会启动独立的后台增量扫描；未变化图片会复用尺寸和标签。后台索引有自己的任务通道，不会阻塞艺术家检查更新或相似图片扫描。

“图库体检”是只读诊断，检查数据库是否可读、艺术家保存路径是否失效或互相重叠、浏览器用户数据目录是否位于图库内、隔离目录是否安全可写，以及图库索引是否过期。体检不会创建、移动或删除图片。

图库中的收藏、0–5 星评分、图片标签和“参考价值高 / 已用过 / 待整理”状态都保存在 `library_index.json`，重新扫描时会随未变化文件继续保留。缩略图左上角可多选图片并批量修改这些字段；“将 Pixiv 标签加入本地标签”只复制已经抓取到索引中的原始 Pixiv 标签，不会再次联网。

详情页修改收藏、评分或整理状态时会立即更新界面，后台写入按顺序执行，避免快速连续点击互相覆盖。若写入失败，软件会重新加载索引恢复真实状态并记录错误。大图库的筛选结果和侧栏计数会延后重算，因此点标签和取消标签时不再阻塞当前交互。

“导出列表”生成带 UTF-8 BOM 的 CSV。有选中图片时只导出所选；没有选中时导出当前筛选结果，因此可以先按作者、文件夹、标签、评分或状态筛选，再导出对应素材清单。

## Pixiv Cookie 与隐私风险

下载限制级或登录可见作品可能需要 Pixiv 会话 Cookie，通常是 `PHPSESSID`。账号还必须在 Pixiv 设置中允许浏览 R-18，否则即使有 Cookie，作品也不会出现在远程列表里。

Cookie 等同于登录凭证。只要持有有效 `PHPSESSID`，无需密码就可能：

- 查看私密收藏、私信、购买记录、关注列表。
- 以你的身份点赞、关注、评论、发布或删除作品。
- 修改部分账号信息。
- 操作 Pixiv Booth / Fanbox 相关购买或赞助。

Pixiv 的二次验证只在新登录时触发，不会保护已经登录的活动会话。

软件会要求你先明确同意 Cookie 风险声明：

- **GUI**：勾选 Cookie 风险同意框，第一次会弹出免责声明，必须点“我同意”。
- **CLI**：首次使用 `--pixiv-cookie` 时需要同时传入 `--accept-cookie-risk`。

同意记录保存在：

```text
.pixiv-pbd-manager/consent.json
```

Cookie 保存方式：

- Windows：使用 DPAPI 加密到 `.pixiv-pbd-manager/cookie.bin`，只有当前 Windows 用户能解密。
- 非 Windows：保存到 `.pixiv-pbd-manager/cookie.txt`，权限设置为 `0600`。
- 不会写入 `gui_settings.json`。
- `.pixiv-pbd-manager/` 已加入 `.gitignore`。

建议：

1. 使用专门的小号。
2. 不要把项目目录放在云盘同步目录。
3. 用完后在 Pixiv 网页端注销会话。
4. 怀疑泄露时立即注销所有会话。

## SSL 证书兼容

如果 Python 环境遇到 `CERTIFICATE_VERIFY_FAILED`，GUI 默认会在证书校验失败时自动重试一次。命令行也默认启用该兼容行为。

如果你想严格校验证书，可以使用：

```powershell
python -m pixiv_pbd_manager scan "C:\PixivLibrary" --resolve-online --no-ssl-fallback
```

## 常用命令行

扫描已有下载，保存艺术家 ID：

```powershell
python -m pixiv_pbd_manager scan "C:\PixivDownloads"
```

扫描旧目录，并用作品 ID 在线解析 Pixiv 艺术家 ID：

```powershell
python -m pixiv_pbd_manager scan "C:\PixivLibrary" --resolve-online
```

开启作者名模糊搜索：

```powershell
python -m pixiv_pbd_manager scan "C:\PixivLibrary" --resolve-online --fuzzy-search
```

扫描时排除目录：

```powershell
python -m pixiv_pbd_manager scan "C:\PixivLibrary" --exclude "C:\PixivLibrary\misc"
```

检查更新：

```powershell
python -m pixiv_pbd_manager check
```

检查更新前递归扫描本地保存路径：

```powershell
python -m pixiv_pbd_manager check --scan-local
```

只检查每个艺术家主页最新前 2 页：

```powershell
python -m pixiv_pbd_manager check --max-pages 2
```

下载检查出的新作品：

```powershell
python -m pixiv_pbd_manager download
```

将 R-18 / R-18G 新作品保存到 `[R-18&R-18G]` 子文件夹：

```powershell
python -m pixiv_pbd_manager download --separate-r18
```

查找相似图片并导出 CSV：

```powershell
python -m pixiv_pbd_manager similar "C:\PixivLibrary" --output similar_report.csv
```

手动添加艺术家：

```powershell
python -m pixiv_pbd_manager add 123456 --name "artist name"
```

打开已记录艺术家的 Pixiv 页面：

```powershell
python -m pixiv_pbd_manager open
```

指定数据库路径：

```powershell
python -m pixiv_pbd_manager scan --db "C:\PixivData\artists.json" "C:\PixivDownloads"
```

指定浏览器：

```powershell
python -m pixiv_pbd_manager open --browser "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

指定浏览器用户数据目录：

```powershell
python -m pixiv_pbd_manager open --browser "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir "C:\PixivBrowserProfile"
```
