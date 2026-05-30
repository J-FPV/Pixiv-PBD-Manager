# Contributing

Thanks for your interest in Pixiv PBD Manager! This is a Tauri 2 (React + TypeScript) desktop shell over a Python backend (`pixiv_pbd_manager`) that talk over JSON-Lines IPC.

## Prerequisites

- Python ≥ 3.9
- Node.js + npm
- Rust + Cargo — only needed to run/build the Tauri app, not for the test driver

## Setup

```bash
pip install -e .[dev]      # backend + ruff + pytest
cd desktop && npm install  # frontend deps
```

## Before you open a PR

Run the smoke driver from the repo root — it runs the four layers a change usually touches:

```bash
python scripts/smoke.py
```

It runs, in order: `pytest`, an in-process IPC contract check, lint (`ruff` + `npm run lint`), and the desktop build (`tsc` + `vite`). Every phase must pass. You can scope it with `--only tests|ipc|lint|build` or `--no-build`.

Keep both linters clean:

- Python: `ruff check pixiv_pbd_manager tests`
- Frontend: `npm run lint` in `desktop/` — **zero warnings**. The ESLint config enforces `max-lines` (500/file) and `max-lines-per-function` (120) as warnings; please decompose rather than suppress.

## Running the app

```bash
cd desktop && npm run tauri:dev    # dev window with hot reload
cd desktop && npm run tauri:build  # production installer
```

## Guidelines

- Keep changes focused; match the style and structure of the surrounding code.
- The Python backend never sends cookies to `i.pximg.net`, and `.pixiv-pbd-manager/` (state, cookie) is never committed — please keep it that way.
- New IPC commands and progress events are mirrored between `pixiv_pbd_manager/events.py` and `desktop/src/events.ts`; keep them in lockstep.
- Releases are cut by maintainers via a `v*` tag; please don't bump versions in PRs unless asked.

## Reporting bugs / requesting features

Use the issue templates. For anything security-related, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
