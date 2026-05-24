# 开发说明

[English](../en/development.md)

这份文档面向想修改或打包项目的人。普通使用者请先看根目录 [README](../../README.md)。

## 当前 GUI 路线

主 GUI 使用 Tauri + React + TypeScript，位于：

```text
desktop/
```

旧 Tkinter GUI 已冻结在单独分支，`main` 分支不再维护 Tkinter 入口。

前端通过 Tauri shell 启动 Python JSON Lines API：

```text
python -m pixiv_pbd_manager.gui_api
```

Python 仍是唯一业务逻辑来源，扫描、检查更新、下载、相似图片、数据库和设置逻辑都在 Python 包里实现。

## 开发环境

需要安装：

- Python 3.9 或更新版本
- Node.js 和 npm
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

修改 `desktop/src-tauri/`、Tauri 插件或权限配置后，需要重启 `npm run tauri:dev`。纯前端和 Python 后端改动通常可以热重载。

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

desktop/
  src/                   # React 前端
  src-tauri/             # Tauri / Rust 壳层

docs/
  zh/                    # 中文文档
  en/                    # English docs
```

## 常用检查

一键跑 pytest + IPC roundtrip + ruff + eslint + 前端构建：

```powershell
python scripts/smoke.py
```

这是 CI 也在跑的脚本(`.github/workflows/checks.yml`)。常用子集:

```powershell
python scripts/smoke.py --only ipc      # 只跑 IPC 烟测
python scripts/smoke.py --only tests    # 只跑后端测试
python scripts/smoke.py --no-build      # 后端改动跳过前端构建
```

也可以手动跑各项:

```powershell
python -m unittest             # 后端测试(CI 用这个)
python -m pytest               # 等价,pyproject 已配置 -p no:cacheprovider
python -m ruff check .         # Ruff lint
cd desktop; npm run lint       # 前端 lint
cd desktop; npm run build      # 前端类型检查 + 生产构建
cd desktop\src-tauri; cargo check
```

## 单独调试 IPC 命令

Tauri 前端调用后端的方式是 `python -m pixiv_pbd_manager.gui_api <cmd> <json-string>`。**手动从 PowerShell 调试时,argv 引号会被吞**(报 `Expecting property name enclosed in double quotes`)。三种可用方式:

```powershell
# 1. in-process(写测试或一次性验证最方便,不经过 shell)
python -c "from pixiv_pbd_manager import gui_api; gui_api.run_command('settings.get', {}, emit=print)"

# 2. --payload-file(等价于 Tauri 的 subprocess 调用,不依赖 shell 引号)
'{"settings": {}}' | Set-Content -NoNewline payload.json -Encoding utf8
python -m pixiv_pbd_manager.gui_api settings.save --payload-file payload.json

# 3. stdin(- 表示从 stdin 读 payload)
'{"settings": {}}' | python -m pixiv_pbd_manager.gui_api settings.save -
```

写 IPC 烟测时注意:`gui_api.payload.resolve_base_dir` 会**向上爬**找 `pixiv_pbd_manager/` 或 `.pixiv-pbd-manager/` 标记目录,所以单独传 `project_root=/tmp/foo` 不足以隔离 —— 还需要先 `mkdir <tmp>/.pixiv-pbd-manager`,否则爬上去会落到仓库根,读写真实用户设置。`scripts/smoke.py` 的 settings.get 阶段会做这个隔离并 assert `settings_path` 没有逃出 fixture。

GUI 回归测试请按 [manual-test-checklist.md](manual-test-checklist.md) 手动跑一遍，尤其是：

- 窗口大小和位置恢复
- 扫描预览
- 未识别文件夹
- 相似图片缩略图和预览
- 暂停、恢复、取消任务
- 中英文切换
- 浏览器打开和用户数据目录安全拦截

## 打包方向

当前开发版依赖本机 Python 环境。最终用户用 PyInstaller 把 Python 后端打包为单文件 exe(Tauri sidecar),由 Tauri 构建安装包。目标是最终用户不需要手动装 Python 依赖。

### 本地打包后端 exe

```powershell
pip install -e ".[build]"
python scripts/build_sidecar.py
```

这一步:
1. 跑 `pyinstaller pixiv-pbd-api.spec` 产出 `dist/pixiv-pbd-api.exe`
2. 通过 `rustc -vV` 检测 host triple,复制到 `desktop/src-tauri/binaries/pixiv-pbd-api-<triple>.exe`(Tauri sidecar 命名规约)

之后 `cd desktop; npm run tauri:build` 就会把这个 exe 嵌进安装包。

单独验证 exe:

```powershell
.\dist\pixiv-pbd-api.exe settings.get '{}'
```

### dev vs prod 行为

- **`npm run tauri:dev`(开发模式)**:用 `tauri.conf.json` 主配置(没有 `externalBin`)。前端通过 `import.meta.env.DEV === true` 检测,继续用 `Command.create("python", ["-m", "pixiv_pbd_manager.gui_api", ...])` 跑源码。改 Python 代码不需要重打包 exe。**不依赖 sidecar exe 存在**。
- **`npm run tauri:build`(生产构建)**:用 `tauri build --config src-tauri/tauri.release.conf.json` 合并出加 `externalBin` 的配置。前端走 `Command.sidecar("binaries/pixiv-pbd-api", ...)`,Tauri 直接拉起嵌入的 exe。**必须先跑 `python scripts/build_sidecar.py`**,否则 Rust 构建会报 `resource path doesn't exist`。

CI(`.github/workflows/checks.yml`)的 `cargo check` 用主配置,所以**不需要 sidecar exe**就能过。

注意:目前 exe 体积 ~344 MB,因为 `imagehash` 拖了 scipy + numpy + PyWavelets。Tauri 安装包打包阶段会进一步压缩,最终用户下载的安装包大小预计 ~100 MB 量级。后续若需要进一步减体积,可以考虑自己实现 phash 替代 imagehash + scipy。

### 发布 release

`.github/workflows/release.yml` 触发于:
- 推 `v*` tag(自动)
- 在 GitHub Actions UI 上手动 dispatch(用于演练)

发布流程:

1. 改 `desktop/src-tauri/tauri.conf.json` 的 `version` 字段(同时改 `pyproject.toml` 保持一致)
2. commit 这次版本改动
3. 打 tag 并 push:
   ```powershell
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. GitHub Actions 自动:
   - 在 windows-latest runner 上 setup Python / Node / Rust
   - 跑 `python scripts/build_sidecar.py` 打 PyInstaller exe
   - 跑 `npm run tauri:build` 出 NSIS + MSI 安装包
   - 用 `softprops/action-gh-release@v2` 创建 GitHub Release,把两个安装包附上去
5. 完成后 release 出现在 https://github.com/J-FPV/Pixiv-PBD-Manager/releases

**prerelease 自动识别:** tag 含 `alpha` / `beta` / `rc` / `dev`(任意大小写组合)→ release 标记为 prerelease,不会顶到 Latest。例如 `v0.2.0-beta.1` 是 prerelease,`v0.2.0` 是正式版。

**手动演练:** 在 release.yml 的 Actions 页点 "Run workflow" 用 workflow_dispatch 跑一次,产物以 artifact 形式上传(不创建 release),用来验证构建本身没问题。

## 数据目录解析

`.pixiv-pbd-manager/` 状态目录的位置按以下优先级解析(`pixiv_pbd_manager/paths.py`):

1. `PIXIV_PBD_DATA_DIR` 环境变量(指向**父目录**,`.pixiv-pbd-manager/` 子目录会在里面创建)
2. 从当前工作目录向上爬,找到的第一个已存在的 `.pixiv-pbd-manager/` 目录
3. OS 标准用户数据目录:
   - Windows: `%APPDATA%/PixivPbdManager/.pixiv-pbd-manager/`
   - macOS:   `~/Library/Application Support/PixivPbdManager/.pixiv-pbd-manager/`
   - Linux:   `$XDG_DATA_HOME/PixivPbdManager/.pixiv-pbd-manager/`(或 `~/.local/share/...`)

开发场景(在仓库根目录跑 `python -m pixiv_pbd_manager.gui_api ...`):向上爬命中仓库自带的 `.pixiv-pbd-manager/`,数据留在仓库内,行为不变。

打包后从开始菜单启动的最终用户场景:向上爬找不到 marker,自动落到 OS 标准位置,数据集中在 APPDATA。

**写 IPC 烟测时:** 单纯 `os.chdir(/tmp/foo)` 不再"自动 fall back 到 cwd",会落到真实 APPDATA 污染数据。要么先 `mkdir <tmp>/.pixiv-pbd-manager`,要么设 `PIXIV_PBD_DATA_DIR=<tmp>`。`tests/test_gui_api.py` 用 `_isolate()` 辅助函数统一处理。

## 维护约定

- IPC event key 由 `pixiv_pbd_manager/events.py` 和 `desktop/src/events.ts` 统一约束。
- `.pixiv-pbd-manager` 相关路径集中在 `pixiv_pbd_manager/paths.py`。
- 新增 Tauri shell 后端命令时，需要同步更新 `desktop/src-tauri/capabilities/default.json`。
- 大任务优先复用 `operations/` 和 `similar/` 中的业务逻辑，不在前端重复实现。
