from __future__ import annotations

import locale
import sys


def has_lone_surrogate(value: str) -> bool:
    return any("\ud800" <= char <= "\udfff" for char in value)


def _candidate_encodings() -> list[str]:
    candidates: list[str] = []
    preferred = locale.getpreferredencoding(False)
    if preferred:
        candidates.append(preferred)
    if sys.platform == "win32":
        candidates.append("mbcs")
    candidates.extend(["gbk", "cp936", "cp932", "shift_jis", "big5"])

    seen: set[str] = set()
    output: list[str] = []
    for encoding in candidates:
        normalized = encoding.lower().replace("_", "-")
        if normalized in seen or normalized in {"utf-8", "utf8"}:
            continue
        seen.add(normalized)
        output.append(encoding)
    return output


def repair_surrogate_mojibake(value: str) -> str:
    """Repair strings that were UTF-8 bytes decoded through a legacy codepage.

    The Tauri/Python IPC must survive lone surrogates, but preserving them in
    artist names or save paths leaves the UI full of mojibake. If a string
    contains surrogateescape characters, try to reverse the common Windows
    failure mode: UTF-8 bytes decoded as the local ANSI codepage.
    """
    if not has_lone_surrogate(value):
        return value

    for encoding in _candidate_encodings():
        try:
            repaired = value.encode(encoding, errors="surrogateescape").decode("utf-8")
        except (LookupError, UnicodeDecodeError, UnicodeEncodeError):
            continue
        if not has_lone_surrogate(repaired):
            return repaired

    return value.encode("utf-8", errors="replace").decode("utf-8")
