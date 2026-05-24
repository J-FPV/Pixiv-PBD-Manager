from __future__ import annotations

import locale
import sys
from pathlib import Path


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


def legacy_mojibake_candidates(value: str) -> list[str]:
    """Return plausible repairs for UTF-8 text decoded through a codepage."""
    candidates: list[str] = []
    for encoding in _candidate_encodings():
        try:
            repaired = value.encode(encoding, errors="surrogateescape").decode("utf-8")
        except (LookupError, UnicodeDecodeError, UnicodeEncodeError):
            continue
        if repaired != value and not has_lone_surrogate(repaired) and repaired not in candidates:
            candidates.append(repaired)
    return candidates


def _path_exists(value: str) -> bool:
    try:
        return Path(value).expanduser().exists()
    except (OSError, RuntimeError, UnicodeError, ValueError):
        return False


def repair_path_mojibake_if_existing(value: str) -> str:
    """Repair a mojibaked path only when the repaired path exists on disk.

    This deliberately stays conservative for surrogate-free mojibake: many
    valid Chinese/Japanese strings can be transformed into other valid strings
    by legacy encodings. Requiring the repaired path to exist avoids silently
    rewriting user data based on a guess.
    """
    repaired_surrogates = repair_surrogate_mojibake(value)
    if repaired_surrogates != value:
        return repaired_surrogates

    if _path_exists(value):
        return value

    for candidate in legacy_mojibake_candidates(value):
        if _path_exists(candidate):
            return candidate
    return value


def repair_text_mojibake_from_context(value: str, context: list[str]) -> str:
    """Repair text when one of its candidates appears in repaired context."""
    repaired_surrogates = repair_surrogate_mojibake(value)
    if repaired_surrogates != value:
        return repaired_surrogates

    for candidate in legacy_mojibake_candidates(value):
        if any(candidate and candidate in item for item in context):
            return candidate
    return value
