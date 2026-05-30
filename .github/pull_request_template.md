## What & why

Briefly describe the change and the motivation. Link any related issue (e.g. `Closes #123`).

## How tested

- [ ] `python scripts/smoke.py` passes (tests + ipc + lint + build)
- [ ] Checked the relevant flow in `npm run tauri:dev` (if UI-facing)

## Checklist

- [ ] Lint is clean (`ruff` + `npm run lint`, zero warnings)
- [ ] No `.pixiv-pbd-manager/`, cookie, or credentials committed
- [ ] IPC/progress event names kept in sync between `events.py` and `events.ts` (if touched)
- [ ] Did not bump the version / cut a release (maintainer does that via a `v*` tag)
