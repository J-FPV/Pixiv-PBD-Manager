"""Remote release metadata for the Settings version card."""

from __future__ import annotations

import json
import re
from urllib.request import Request, urlopen

from ..runtime import Emitter, JsonDict


LATEST_RELEASE_API = "https://api.github.com/repos/J-FPV/Pixiv-PBD-Manager/releases/latest"


def _version_tuple(value: str) -> tuple[int, ...]:
    numbers = [int(item) for item in re.findall(r"\d+", value)]
    return tuple(numbers[:4])


def latest_release(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    request = Request(
        LATEST_RELEASE_API,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "Pixiv-PBD-Manager"},
    )
    with urlopen(request, timeout=10) as response:  # noqa: S310 - fixed HTTPS endpoint
        raw = json.loads(response.read().decode("utf-8"))
    tag = str(raw.get("tag_name") or "").strip()
    if not tag:
        raise ValueError("GitHub did not return a release version")
    current = str(payload.get("current_version") or "").strip()
    return {
        "tag": tag,
        "name": str(raw.get("name") or tag),
        "url": str(raw.get("html_url") or "https://github.com/J-FPV/Pixiv-PBD-Manager/releases"),
        "published_at": str(raw.get("published_at") or ""),
        "notes": str(raw.get("body") or ""),
        "update_available": bool(current and _version_tuple(tag) > _version_tuple(current)),
    }
