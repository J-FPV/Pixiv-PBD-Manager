from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


CONSENT_PATH = Path(".pixiv-pbd-manager") / "consent.json"
COOKIE_CONSENT_VERSION = "1"


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _read(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _write(data: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def is_cookie_consent_recorded(path: Path = CONSENT_PATH) -> bool:
    data = _read(path)
    entry = data.get("cookie") or {}
    return bool(entry.get("accepted_at")) and entry.get("version") == COOKIE_CONSENT_VERSION


def record_cookie_consent(path: Path = CONSENT_PATH) -> None:
    data = _read(path)
    data["cookie"] = {"accepted_at": _utc_now(), "version": COOKIE_CONSENT_VERSION}
    _write(data, path)


def revoke_cookie_consent(path: Path = CONSENT_PATH) -> None:
    data = _read(path)
    if "cookie" in data:
        data.pop("cookie", None)
        _write(data, path)
