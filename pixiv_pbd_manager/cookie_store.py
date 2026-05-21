from __future__ import annotations

import ctypes
import os
import sys
from ctypes import wintypes
from pathlib import Path


COOKIE_DIR = Path(".pixiv-pbd-manager")
COOKIE_BIN = COOKIE_DIR / "cookie.bin"
COOKIE_TXT = COOKIE_DIR / "cookie.txt"

CRYPTPROTECT_UI_FORBIDDEN = 0x1


class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def _to_blob(data: bytes) -> _DataBlob:
    buffer = ctypes.create_string_buffer(data, len(data))
    blob = _DataBlob()
    blob.cbData = len(data)
    blob.pbData = ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte))
    blob._buffer = buffer  # type: ignore[attr-defined]  # keep alive
    return blob


def _from_blob(blob: _DataBlob) -> bytes:
    raw = ctypes.string_at(blob.pbData, blob.cbData)
    ctypes.windll.kernel32.LocalFree(blob.pbData)
    return raw


def _dpapi_encrypt(plaintext: bytes) -> bytes:
    in_blob = _to_blob(plaintext)
    out_blob = _DataBlob()
    ok = ctypes.windll.crypt32.CryptProtectData(
        ctypes.byref(in_blob),
        ctypes.c_wchar_p("pixiv-pbd-manager"),
        None,
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(out_blob),
    )
    if not ok:
        raise OSError(ctypes.WinError().strerror)
    return _from_blob(out_blob)


def _dpapi_decrypt(ciphertext: bytes) -> bytes:
    in_blob = _to_blob(ciphertext)
    out_blob = _DataBlob()
    ok = ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(in_blob),
        None,
        None,
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(out_blob),
    )
    if not ok:
        raise OSError(ctypes.WinError().strerror)
    return _from_blob(out_blob)


def _restrict_permissions(path: Path) -> None:
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def load_cookie(directory: Path = COOKIE_DIR) -> str | None:
    bin_path = directory / COOKIE_BIN.name
    txt_path = directory / COOKIE_TXT.name
    if sys.platform == "win32" and bin_path.exists():
        try:
            return _dpapi_decrypt(bin_path.read_bytes()).decode("utf-8").strip() or None
        except OSError:
            pass
    if txt_path.exists():
        return txt_path.read_text(encoding="utf-8").strip() or None
    return None


def save_cookie(value: str, directory: Path = COOKIE_DIR) -> Path:
    value = (value or "").strip()
    directory.mkdir(parents=True, exist_ok=True)
    bin_path = directory / COOKIE_BIN.name
    txt_path = directory / COOKIE_TXT.name

    if not value:
        clear_cookie(directory)
        return bin_path

    if sys.platform == "win32":
        try:
            bin_path.write_bytes(_dpapi_encrypt(value.encode("utf-8")))
            _restrict_permissions(bin_path)
            if txt_path.exists():
                try:
                    txt_path.unlink()
                except OSError:
                    pass
            return bin_path
        except OSError:
            pass

    txt_path.write_text(value, encoding="utf-8")
    _restrict_permissions(txt_path)
    return txt_path


def clear_cookie(directory: Path = COOKIE_DIR) -> None:
    for name in (COOKIE_BIN.name, COOKIE_TXT.name):
        path = directory / name
        if path.exists():
            try:
                path.unlink()
            except OSError:
                pass


def storage_label(directory: Path = COOKIE_DIR) -> str:
    bin_path = directory / COOKIE_BIN.name
    txt_path = directory / COOKIE_TXT.name
    if bin_path.exists():
        return "dpapi"
    if txt_path.exists():
        return "plaintext"
    return "empty"
