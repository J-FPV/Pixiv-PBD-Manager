# 开发说明

[English](../en/development.md)

这份文档面向想修改、测试、打包或发布项目的人。普通使用者请先看根目录 [README](../../README.md)。

## 当前 GUI 路线

主 GUI 使用 Tauri + React + TypeScript，位于：

```text
desktop/
```

旧 Tkinter GUI 已冻结在单独分支，`main` 分支不再维护 Tkinter 入口。

Python 仍是唯一业务逻辑来源。扫描、检查更新、下载、相似图片、数据库、设置和 Cookie 逻辑都在 Python 包里实现；前端只负责界面、任务状态和调用后端。

## 运行架构

开发模式：

- 前端通过 `Command.create("python" | "py", ["-m", "pixiv_pbd_manager.gui_api", ...])` 启动源码后端。
- `PYTHONPATH` 指向项目根目录，改 Python 代码通常不需要重打包。
- 修改 `desktop/src-tauri/`、Rust 代码、Tauri 插件或权限配置后，需要重启 `npm run tauri:dev`。

生产模式：

- `python scripts/build_sidecar.py` 使用 PyInstaller `--onedir` 产出一个后端文件夹，而不是单文件 sidecar。
- 生成目录会复制到 `desktop/src-tauri/binaries/pixiv-pbd-api/`。
- `desktop/src-tauri/tauri.release.conf.json` 通过 `bundle.resources` 把该目录打进安装包。
- 安装后该目录位于安装目录下的 `pixiv-pbd-api/`，入口是 `pixiv-pbd-api/pixiv-pbd-api.exe`。
- 前端通过 `Command.create("pixiv-pbd-api", [commandName, payload])` 调用它；`desktop/src-tauri/capabilities/default.json` 把命令名映射到安装相对路径。

注意：项目里有些历史命名仍叫 `sidecar`，但当前生产包实际采用的是 **PyInstaller onedir + Tauri resources + shell allow-list**。没有使用 Tauri `externalBin` sidecar 机制，因为 `externalBin` 更适合单文件可执行程序，而这里需要一起携带 `_internal/` Python 运行时目录。

前后端 IPC 使用 JSON Lines。为避开 Windows 控制台编码问题，前端传入 ASCII JSON，后端 stdout 也按 UTF-8 字节写出。stdin payload 优先从二进制缓冲区读取并按 `utf-8-sig` 解码，因此兼容 Windows PowerShell 5.1 可能添加的 UTF-8 BOM，也不会经过 GBK 文本层把 BOM 变成乱码。

## 开发环境

需要安装：

- Python 3.9 或更新版本
- Node.js 20.19+ 或 22.12+，以及 npm
- Rust 和 Cargo

初始化：

```powershell
pip install -e ".[dev]"
cd desktop
npm install
```

启动开发 GUI：

```powershell
npm run tauri:dev
```

如果 Tauri 界面无法导入 `pixiv_pbd_manager`，在 Settings 页把 `Project root` 设置为仓库根目录。

## 项目结构

```text
pixiv_pbd_manager/
  cli.py                 # 命令行入口
  database.py            # artists.json 数据库
  browser.py             # 打开浏览器 / PBD 页面
  downloader.py          # 直接下载器
  events.py              # 后端 IPC event key
  paths.py               # .pixiv-pbd-manager 路径常量
  gui_api/               # Tauri 调用的 JSON Lines API
  operations/            # 扫描、预览、检查更新、下载编排
  similar/               # 相似图片索引与分组
  library/               # 图库目录、增量索引与图片元数据
  doctor.py              # 图库只读诊断

desktop/
  src/                   # React 前端
  src-tauri/             # Tauri / Rust 壳层、权限、打包配置
  e2e/                   # Mock GUI 测试与截图驱动

docs/
  zh/                    # 中文文档
  en/                    # English docs
```

## 常用检查

一键跑后端测试、IPC 烟测、ruff、eslint、前端构建：

```powershell
python scripts/smoke.py
```

这是 CI 也在跑的脚本(`.github/workflows/checks.yml`)。常用子集：

```powershell
python scripts/smoke.py --only ipc      # 只跑 IPC 烟测
python scripts/smoke.py --only tests    # 只跑后端测试
python scripts/smoke.py --no-build      # 后端改动跳过前端构建
```

也可以手动跑各项：

```powershell
python -m unittest             # 后端测试
python -m pytest               # 等价，pyproject 已配置 -p no:cacheprovider
python -m ruff check .         # Ruff lint
cd desktop; npm run lint       # 前端 lint
cd desktop; npm run build      # 前端类型检查 + 生产构建
cd desktop; npm run test:e2e   # Mock 后端 GUI 冒烟测试（使用本机 Chrome）
cd desktop\src-tauri; cargo check
```

不连接 Pixiv、Python sidecar 或真实图库也可以单独启动前端：

```powershell
cd desktop
npm run dev:mock
```

Mock 模式提供固定的艺术家、图库、扫描预览和相似图片数据，仅在 Vite 开发模式启用，不会进入正式安装包。

需要批量生成当前 GUI 截图时，可以运行：

```powershell
cd desktop
node e2e/screenshot.mjs
```

脚本会复用已运行的 `dev:mock`，或自行启动它，并生成艺术家、图库、详情、扫描预览、相似图片和设置页截图。仓库中的 `.claude/skills/run-pixiv-pbd-manager/SKILL.md` 记录了自动化验证顺序和截图用法。

如果改了 GUI API 命令、Tauri shell 权限或前端 `runGuiApi(...)` 调用，至少跑：

```powershell
python -m unittest tests.test_shell_permissions
```

该测试会检查三件事是否同步：

- `pixiv_pbd_manager.gui_api.COMMANDS`
- `desktop/src-tauri/capabilities/default.json`
- 前端源码里的 `runGuiApi("...")` 调用

## 单独调试 IPC 命令

Tauri 前端调用后端的方式是：

```text
python -m pixiv_pbd_manager.gui_api <cmd> <json-string>
```

手动从 PowerShell 调试时，argv 引号可能被吞掉，导致 JSON 变成非法格式并报 `Expecting property name enclosed in double quotes`。可用以下方式：

```powershell
# 1. in-process：写测试或一次性验证最方便，不经过 shell
python -c "from pixiv_pbd_manager import gui_api; gui_api.run_command('settings.get', {}, emit=print)"

# 2. --payload-file：不依赖 shell 引号
'{"settings": {}}' | Set-Content -NoNewline payload.json -Encoding utf8
python -m pixiv_pbd_manager.gui_api settings.save --payload-file payload.json

# 3. stdin：- 表示从 stdin 读 payload；PowerShell BOM 会按 utf-8-sig 处理
'{"settings": {}}' | python -m pixiv_pbd_manager.gui_api settings.save -
```

写 IPC 烟测时注意：`gui_api.payload.resolve_base_dir` 会向上找 `pixiv_pbd_manager/` 或 `.pixiv-pbd-manager/` 标记目录。单独传 `project_root=/tmp/foo` 不足以隔离，还需要先创建 `<tmp>/.pixiv-pbd-manager`，否则可能爬到仓库根目录并读写真实用户设置。`scripts/smoke.py` 和 `tests/test_gui_api.py` 已经处理了这个隔离。

GUI 回归测试请按 [manual-test-checklist.md](manual-test-checklist.md) 手动跑一遍，尤其是：

- 窗口大小和位置恢复
- 扫描预览
- 未识别文件夹
- 相似图片缩略图、预览和差异图
- 暂停、恢复、取消任务
- 中英文切换
- 浏览器打开和用户数据目录安全拦截

## 本地打包

先构建 Python 后端：

```powershell
pip install -e ".[build]"
python scripts/build_sidecar.py
```

这一步会：

1. 跑 `pyinstaller pixiv-pbd-api.spec`
2. 产出 `dist/pixiv-pbd-api/`
3. 复制到 `desktop/src-tauri/binaries/pixiv-pbd-api/`

单独验证后端：

```powershell
.\dist\pixiv-pbd-api\pixiv-pbd-api.exe settings.get '{}'
```

然后构建 Tauri 安装包：

```powershell
cd desktop
npm run tauri:build
```

构建成功后会生成 NSIS 和 MSI 安装包，位置通常在：

```text
desktop/src-tauri/target/release/bundle/
```

本机如果 WiX 或 NSIS 打包工具卡住，不一定代表 Rust 或前端编译失败。CI 的 Windows runner 是发布安装包的最终准绳。

## CI 打包演练

需要安装包测试但暂时不发布版本时，在 GitHub Actions 手动运行 `Package` workflow。它只拥有只读仓库权限，只上传保留 14 天的 NSIS/MSI artifact；名称包含软件版本、commit 短 SHA 和 run 编号。

## 发布 release

`.github/workflows/release.yml` 触发于：

- 推送 `v*` tag

安装包演练统一使用 `Package` workflow，`Release` 不再提供手动触发，避免把“拿测试包”和“正式发布”混在一起。

发布前请同步版本号：

- `pyproject.toml`
- `desktop/package.json`
- `desktop/package-lock.json`
- `desktop/src-tauri/Cargo.toml`
- `desktop/src-tauri/Cargo.lock`
- `desktop/src-tauri/tauri.conf.json`

发布流程：

```powershell
git status
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

GitHub Actions 会自动：

1. 在 Windows runner 上安装 Python / Node / Rust。
2. 跑 `python scripts/build_sidecar.py` 打包 PyInstaller onedir 后端。
3. 跑 `npm run tauri:build` 生成 `setup.exe` 和 `msi`。
4. 用 `softprops/action-gh-release@v2` 创建 GitHub Release 并上传安装包。

手动检查发布状态：

```powershell
gh run list --repo J-FPV/Pixiv-PBD-Manager --workflow Release --limit 5
gh release view vX.Y.Z --repo J-FPV/Pixiv-PBD-Manager
```

tag 含 `alpha` / `beta` / `rc` / `dev` 时会自动标记为 prerelease。

## 数据目录

`.pixiv-pbd-manager/` 状态目录的位置按以下优先级解析(`pixiv_pbd_manager/paths.py`)：

1. `PIXIV_PBD_DATA_DIR` 环境变量。它指向父目录，`.pixiv-pbd-manager/` 子目录会在里面创建。
2. 从当前工作目录向上找，命中第一个已存在的 `.pixiv-pbd-manager/`。
3. OS 标准用户数据目录：
   - Windows: `%APPDATA%/PixivPbdManager/.pixiv-pbd-manager/`
   - macOS: `~/Library/Application Support/PixivPbdManager/.pixiv-pbd-manager/`
   - Linux: `$XDG_DATA_HOME/PixivPbdManager/.pixiv-pbd-manager/` 或 `~/.local/share/...`

开发场景从仓库根目录运行时，会命中仓库内的 `.pixiv-pbd-manager/`。

安装版从开始菜单启动时，通常会落到 `%APPDATA%\PixivPbdManager\.pixiv-pbd-manager\`。

Tauri WebView 的 `localStorage` 另由系统管理，例如 Windows 上通常位于：

```text
%LOCALAPPDATA%\com.jfpv.pixivpbdmanager\EBWebView\
```

这里保存的是前端本地状态，例如开发模式的 `Project root` 和 Python 命令选择。核心数据库仍在 `.pixiv-pbd-manager/`。

## 维护约定

- IPC event key 由 `pixiv_pbd_manager/events.py` 和 `desktop/src/events.ts` 统一约束，并由 `tests/test_events.py` 检查。
- GUI API 命令需要同时维护 `pixiv_pbd_manager/gui_api/__init__.py`、Tauri shell capability 和前端调用，并由 `tests/test_shell_permissions.py` 检查。
- `.pixiv-pbd-manager` 相关路径集中在 `pixiv_pbd_manager/paths.py`。
- 大任务优先复用 `operations/` 和 `similar/` 中的业务逻辑，不在前端重复实现。
- 正式版本的用户说明分别维护在 `README.md` / `README.en.md`，版本重点维护在 `docs/zh/release-notes.md` / `docs/en/release-notes.md`。
