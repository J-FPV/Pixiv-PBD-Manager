"""File creation timestamps without confusing Unix ctime with birth time."""

from __future__ import annotations

import os
import sys


def file_creation_time_ns(stat: os.stat_result) -> int | None:
    birth_ns = getattr(stat, "st_birthtime_ns", None)
    if birth_ns is not None:
        return int(birth_ns)
    birth = getattr(stat, "st_birthtime", None)
    if birth is not None:
        return int(birth * 1_000_000_000)
    # Windows Python <3.12 exposes creation time through ctime only.
    if sys.platform == "win32" and sys.version_info < (3, 12):
        return int(stat.st_ctime_ns)
    return None
