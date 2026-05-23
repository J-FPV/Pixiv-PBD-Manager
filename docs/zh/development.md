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

后端测试：

```powershell
python -m unittest
```

Ruff：

```powershell
python -m ruff check .
```

Pytest：

```powershell
python -m pytest
```

前端类型检查和生产构建：

```powershell
cd desktop
npm run lint
npm run build
```

Rust 检查：

```powershell
cd desktop\src-tauri
cargo check
```

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

## 维护约定

- IPC event key 由 `pixiv_pbd_manager/events.py` 和 `desktop/src/events.ts` 统一约束。
- `.pixiv-pbd-manager` 相关路径集中在 `pixiv_pbd_manager/paths.py`。
- 新增 Tauri shell 后端命令时，需要同步更新 `desktop/src-tauri/capabilities/default.json`。
- 大任务优先复用 `operations/` 和 `similar/` 中的业务逻辑，不在前端重复实现。
