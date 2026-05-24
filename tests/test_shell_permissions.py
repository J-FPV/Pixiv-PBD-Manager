"""Keep frontend IPC calls and Tauri shell allow-list in sync."""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

from pixiv_pbd_manager.gui_api import COMMANDS


REPO_ROOT = Path(__file__).resolve().parents[1]
CAPABILITY_FILE = REPO_ROOT / "desktop" / "src-tauri" / "capabilities" / "default.json"
FRONTEND_SRC = REPO_ROOT / "desktop" / "src"
COMMAND_CALL_PATTERN = re.compile(r'runGuiApi(?:<[\s\S]*?>)?\(\s*"(?P<command>[a-z_.]+)"')


def _allowed_commands_by_scope() -> dict[str, set[str]]:
    capability = json.loads(CAPABILITY_FILE.read_text(encoding="utf-8"))
    shell_permission = next(
        permission
        for permission in capability["permissions"]
        if isinstance(permission, dict) and permission.get("identifier") == "shell:allow-spawn"
    )
    scopes: dict[str, set[str]] = {}
    for entry in shell_permission["allow"]:
        validators = [arg["validator"] for arg in entry["args"] if isinstance(arg, dict) and "validator" in arg]
        command_validator = next(validator for validator in validators if "settings\\.get" in validator)
        match = re.fullmatch(r"\^\(\?:(?P<body>.+)\)\$", command_validator)
        if not match:
            raise AssertionError(f"Unexpected command validator shape: {command_validator}")
        scopes[entry["name"]] = {item.replace("\\.", ".") for item in match.group("body").split("|")}
    return scopes


def _frontend_commands() -> set[str]:
    commands: set[str] = set()
    for source in FRONTEND_SRC.rglob("*"):
        if source.suffix not in {".ts", ".tsx"}:
            continue
        commands.update(match.group("command") for match in COMMAND_CALL_PATTERN.finditer(source.read_text(encoding="utf-8")))
    return commands


class ShellPermissionTests(unittest.TestCase):
    def test_shell_scopes_allow_all_backend_commands(self):
        expected = set(COMMANDS)
        for name, commands in _allowed_commands_by_scope().items():
            with self.subTest(scope=name):
                self.assertSetEqual(commands, expected)

    def test_frontend_only_calls_known_backend_commands(self):
        self.assertLessEqual(_frontend_commands(), set(COMMANDS))


if __name__ == "__main__":
    unittest.main()
