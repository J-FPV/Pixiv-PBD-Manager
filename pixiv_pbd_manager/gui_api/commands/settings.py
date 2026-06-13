"""Commands for reading/writing GUI settings and cookie consent."""

from __future__ import annotations

from ...consent import is_cookie_consent_recorded, record_cookie_consent, revoke_cookie_consent
from ...cookie_store import clear_cookie, load_cookie, save_cookie, storage_label
from ...text_safety import repair_path_mojibake_if_existing
from ..payload import base_dir, load_json, save_json, settings_path
from ..runtime import Emitter, JsonDict


PATH_LIST_KEYS = {"download_roots", "exclude_roots"}
PATH_TEXT_KEYS = {"database", "browser", "user_data_dir", "quarantine_dir"}


def repair_settings_paths(settings: JsonDict) -> JsonDict:
    repaired = dict(settings)
    for key in PATH_LIST_KEYS:
        values = repaired.get(key)
        if isinstance(values, list):
            repaired[key] = [repair_path_mojibake_if_existing(str(value)) for value in values]
    for key in PATH_TEXT_KEYS:
        value = repaired.get(key)
        if isinstance(value, str) and value:
            repaired[key] = repair_path_mojibake_if_existing(value)
    return repaired


def _settings_result(settings: JsonDict, payload: JsonDict) -> JsonDict:
    consent = is_cookie_consent_recorded()
    cookie = load_cookie() if consent else None
    return {
        "settings": settings,
        "cookie_consent": consent,
        "pixiv_cookie": cookie or "",
        "has_cookie": bool(cookie),
        "cookie_storage": storage_label(),
        "project_root": str(base_dir(payload)),
        "settings_path": str(settings_path(payload)),
    }


def load_settings_for_payload(payload: JsonDict) -> JsonDict:
    """Read the on-disk settings JSON for this payload's project root."""
    return repair_settings_paths(load_json(settings_path(payload)))


def get(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    return _settings_result(load_settings_for_payload(payload), payload)


def save(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    settings = repair_settings_paths(dict(payload.get("settings") or {}))
    save_json(settings_path(payload), settings)

    if "cookie_consent" in payload:
        if payload.get("cookie_consent"):
            record_cookie_consent()
        else:
            revoke_cookie_consent()
            clear_cookie()

    if payload.get("pixiv_cookie") is not None:
        cookie_text = str(payload.get("pixiv_cookie") or "").strip()
        if cookie_text:
            record_cookie_consent()
            save_cookie(cookie_text)
        else:
            clear_cookie()

    return _settings_result(settings, payload)


def revoke_cookie(payload: JsonDict, _emit_event: Emitter) -> JsonDict:
    revoke_cookie_consent()
    clear_cookie()
    return _settings_result(load_settings_for_payload(payload), payload)
