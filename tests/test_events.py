"""Cross-language consistency check for the IPC event-key table.

The Python side (pixiv_pbd_manager/events.py) and the TypeScript side
(desktop/src/events.ts) declare the same set of progress_* string constants.
If the two ever drift, the frontend's switch falls through to the catch-all
log formatter and the progress bar stops updating — graceful degradation,
but a silent regression. This test catches the drift early.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from pixiv_pbd_manager import events as backend_events


REPO_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_EVENTS = REPO_ROOT / "desktop" / "src" / "events.ts"

# Match `export const NAME = "value";`
TS_CONST_PATTERN = re.compile(
    r'export\s+const\s+(?P<name>[A-Z_][A-Z0-9_]*)\s*=\s*"(?P<value>progress_[a-z_]+)"\s*;'
)


def _backend_constants() -> dict[str, str]:
    return {
        name: value
        for name, value in vars(backend_events).items()
        if name.startswith("PROGRESS_") and isinstance(value, str)
    }


def _frontend_constants() -> dict[str, str]:
    if not FRONTEND_EVENTS.exists():
        raise FileNotFoundError(f"Missing frontend events file: {FRONTEND_EVENTS}")
    text = FRONTEND_EVENTS.read_text(encoding="utf-8")
    return {match.group("name"): match.group("value") for match in TS_CONST_PATTERN.finditer(text)}


class EventConstantsTests(unittest.TestCase):
    def test_backend_and_frontend_names_match(self):
        self.assertSetEqual(set(_backend_constants()), set(_frontend_constants()))

    def test_backend_and_frontend_values_match(self):
        self.assertEqual(_backend_constants(), _frontend_constants())


if __name__ == "__main__":
    unittest.main()
