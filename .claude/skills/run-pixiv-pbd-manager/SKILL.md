---
name: run-pixiv-pbd-manager
description: Build, smoke-test, drive, and screenshot the Pixiv PBD Manager — a Tauri 2 desktop app over a Python JSON-IPC backend. Use when asked to run, start, test, build, lint, or take a screenshot of this project, verify a PR locally, or smoke-test backend or frontend changes.
---

Pixiv PBD Manager is a desktop app: a Tauri 2 (React 19 + WebView2) shell that drives a Python backend (`pixiv_pbd_manager`) via JSON-Lines IPC over `python -m pixiv_pbd_manager.gui_api <cmd> <json>`.

Two drivers, both committed to the repo:

1. **`scripts/smoke.py`** — backend + build gate: pytest (221 tests), in-process IPC smoke, ruff + eslint, tsc + vite.
2. **`desktop/e2e/screenshot.mjs`** — GUI driver: boots the frontend against `src/mockApi.ts` (no Tauri shell, no Python) in headless Chrome and writes PNGs of the main views. `desktop/e2e/mock-gui.spec.ts` (`npx playwright test`) asserts the same flows.

All paths below are relative to the repo root. Host is **Windows 11 + PowerShell + miniconda Python 3.9 + Chrome installed**.

## Prerequisites

Already installed in this environment; a fresh machine needs:

- Python ≥ 3.9, plus the package: `pip install -e .[dev]` (`[dev]` pulls in `ruff` + `pytest`)
- Node.js + npm, then `cd desktop && npm install`
- Google Chrome (Playwright runs `channel: "chrome"` — no browser download needed)
- Rust + Cargo (only for `npm run tauri:dev`/`tauri:build`; **not** needed by either driver)

## Run the smoke driver (backend + build)

```powershell
python scripts/smoke.py
```

Expected output ends with:

```
=== summary ===
  tests  OK
  ipc    OK
  lint   OK
  build  OK
```

Exit code is 0 only when every requested phase passes. Phase flags:

```powershell
python scripts/smoke.py --only tests    # 221 tests, ~5 s
python scripts/smoke.py --only ipc      # ~2 s
python scripts/smoke.py --only lint     # ruff + eslint
python scripts/smoke.py --only build    # tsc + vite
python scripts/smoke.py --no-build      # backend-only PR
```

The IPC phase does a real `scan.run` (writes `12345_p0.jpg` under `Smoke Artist-99999/` in a temp fixture, asserts the artist lands in the JSON DB) and an isolated `settings.get`. It catches contract breaks in `gui_api/commands/`, `operations/`, and the scanner.

`scripts/smoke.py` does **not** compile Rust. If you touched `desktop/src-tauri/src/`, also run:

```powershell
cd desktop/src-tauri
cargo check --message-format short
```

## See the GUI (agent path — headless screenshots)

The frontend runs in a plain browser against `desktop/src/mockApi.ts` (vite `--mode mock`, port 1421). The screenshot driver boots that server if needed, drives it in headless Chrome, and prints the PNG paths it wrote:

```powershell
cd desktop
node e2e/screenshot.mjs                 # all views
node e2e/screenshot.mjs library detail  # just these
```

Views: `artists`, `library`, `detail` (image modal), `scan-preview`, `similar`, `settings`. Output lands in `desktop/test-results/screenshots/<view>.png` (gitignored); `--out=<dir>` overrides. Exit 0 with no `page errors:` output means the views rendered without console/page errors — then **read the PNGs** to verify visuals.

The assertion twin — same flows, pass/fail instead of pictures:

```powershell
cd desktop
npx playwright test
```

Both reuse an already-running mock server on 1421 and start one if absent. Mock data lives in `desktop/src/mockData.ts`; the mock UI is pinned to Chinese (`language: zh`), so locators use zh labels (图库, 扫描, 关闭…).

**Limits of the mock path:** anything Rust-side is invisible to it — the native `thumb://` thumbnail protocol errors in a plain browser and tiles fall back to the mock IPC thumbnail, and real Python IPC is stubbed. Verifying those needs the real window (below) or an installer build.

## Direct invocation — testing one IPC command

Three forms that work from PowerShell (payload shapes: `pixiv_pbd_manager/gui_api/__init__.py` `COMMANDS` dict + `gui_api/commands/*.py`):

```powershell
# (a) in-process (best for one-offs; no subprocess at all)
python -c "from pixiv_pbd_manager import gui_api; gui_api.run_command('settings.get', {}, emit=print)"

# (b) payload file (Tauri-equivalent subprocess, no argv quoting)
'{}' | Set-Content -NoNewline payload.json -Encoding utf8
python -m pixiv_pbd_manager.gui_api settings.get --payload-file payload.json

# (c) stdin
'{}' | python -m pixiv_pbd_manager.gui_api settings.get -
```

Do **not** pass JSON as a plain argv from PowerShell (`python -m … scan.run '{"roots":…}'`) — PowerShell strips the inner double quotes and Python dies with `Expecting property name enclosed in double quotes`. The Tauri frontend uses argv form safely because it spawns Python without a shell.

Note `settings.get` reads the **real** `.pixiv-pbd-manager/gui_settings.json` when run from the repo root. For a write-y command, isolate first: create `<tmp>/.pixiv-pbd-manager/` and pass `"project_root": "<tmp>"` in the payload (see Gotchas).

## Run the real window (human path)

Only needed for Rust-side verification (`thumb://` thumbnails, window state, shell allowlist) or visual checks against `docs/zh/manual-test-checklist.md`:

```powershell
cd desktop
npm run tauri:dev
```

Spawns Vite on `http://127.0.0.1:1420` plus a native window; first run compiles Rust for minutes, later runs are seconds. Ctrl-C closes it. `npm run tauri:build` produces the NSIS installer (release config). An agent cannot screenshot the WebView2 window — use the mock path above for pixels.

## Gotchas

- **PowerShell strips quotes from JSON argv** — see Direct invocation. Use `--payload-file`, stdin `-`, or in-process.
- **PowerShell pipes prepend a UTF-8 BOM and this host's stdin decodes as GBK.** The backend reads the stdin payload as bytes and decodes `utf-8-sig` (`gui_api/__init__.py::_read_payload_source`) precisely so form (c) works. If you write similar plumbing, read `sys.stdin.buffer`, never the text layer.
- **`project_root` alone doesn't isolate from the real `.pixiv-pbd-manager/`.** `payload.resolve_base_dir` walks up until it finds `pixiv_pbd_manager/` or `.pixiv-pbd-manager/` — from a bare temp dir it reaches the repo root and touches real user settings. Isolate with `mkdir <tmp>/.pixiv-pbd-manager` first; the smoke driver's `settings.get` phase asserts this stays inside the fixture.
- **`scan.run` resolves relative `roots` against `project_root`, not CWD.** Pass `project_root` explicitly when scanning a fixture.
- **`/tmp/foo` in Git Bash ≠ Python's `/tmp/foo`.** Git Bash maps `/tmp`; a Python child resolves it against its own CWD. Always hand Python absolute Windows paths.
- **Playwright strict mode on zh labels:** on the library tab, `name: "图库"` also matches the 图库体检 button — use `exact: true`. Same trap for any label that prefixes another.
- **Modal overlays eat the next click.** After screenshotting the detail/scan-preview modals, close them (关闭 / 取消) before switching tabs; `screenshot.mjs` view functions return a cleanup for exactly this.
- **Cookie handling is non-negotiable.** The backend never sends cookies to `i.pximg.net` (Referer only); on Windows the cookie is DPAPI-encrypted to `.pixiv-pbd-manager/cookie.bin`. Don't bypass `cookie_store.load_cookie()`, don't commit `.pixiv-pbd-manager/`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ModuleNotFoundError: No module named 'pixiv_pbd_manager'` | `pip install -e .` from repo root. |
| `Invalid JSON payload: Expecting property name enclosed in double quotes` | JSON argv through PowerShell. Use `--payload-file`, `-`, or in-process. |
| `Invalid JSON payload: Expecting value: line 1 column 1 (char 0)` on stdin form | You're on a build older than the `utf-8-sig` stdin fix — the PS pipe BOM got GBK-mangled. Update, or use `--payload-file`. |
| `No module named ruff` in lint phase | `pip install -e .[dev]`. |
| screenshot.mjs / playwright: browser fails to launch | Chrome not installed (config uses `channel: "chrome"`); install Chrome or switch the channel. |
| `dev:mock did not come up on :1421` | Port taken by something that isn't the mock server, or first `npm install` still missing — run `npm install` in `desktop/`, retry. |
| Orphaned vite still holding :1421 (e.g. after Ctrl-C mid-driver) | `(Get-NetTCPConnection -LocalPort 1421).OwningProcess` → `taskkill /PID <pid> /T /F`. The driver does this itself on normal exit — `taskkill /T` on the npm tree alone is not enough, vite's node child gets orphaned. |
| Driver hangs on build phase | First `npm install` takes minutes; later runs are seconds. |
| `tauri:dev` first run takes forever | Rust compiling all Tauri crates. Normal. |
| Smoke fixture leaks under `%TEMP%` | Only after a mid-run Ctrl-C; `%TEMP%\pbd-smoke-*` / `pbd-settings-*` are safe to delete. |
