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

当前开发版依赖本机 Python 环境。稳定后计划使用 PyInstaller 将 Python 后端打包为 Tauri sidecar，再由 Tauri 构建安装包。目标是最终用户不需要手动安装 Python 依赖。

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
