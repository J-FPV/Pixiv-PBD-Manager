"""Backup allowlists deliberately exclude credentials and transient UI caches."""

import json
import math

SETTINGS_KEYS = set("language theme download_roots download_roots_textarea_height exclude_roots exclude_roots_textarea_height quarantine_dir browser user_data_dir delay limit download_concurrency watch_interval resolve_online resolve_limit fuzzy_search fuzzy_min_score ssl_fallback similar_threshold similar_skip_pixiv_pages scan_local_subfolders scan_max_depth scan_recognize_low_pids update_check_depth update_check_pages separate_r18 show_progress_percent ui_preferences".split())
UI_KEYS = set("librarySort similarRoots similarExcludes similarRootBoxHeight similarExcludeBoxHeight librarySidebarWidth artistsColWidths unmatchedColWidths similarColWidths windowState".split())
UNDO_ARTISTS = {"artists.assign_folder", "artists.rename", "artists.set_save_path"}
UNDO_IMAGES = {"library.set_tags", "library.update_metadata"}
CHECKPOINTS = {"scan.apply", "scan.run", "artists.remove", "artists.add_tag", "artists.set_tags", "artists.rename_tag", "artists.delete_tag", "artists.assign_tag", "artists.rebuild_work_index.apply", "artists.refresh_names", "artists.rename"}
BOOLEAN_KEYS = set("resolve_online fuzzy_search ssl_fallback similar_skip_pixiv_pages scan_local_subfolders scan_recognize_low_pids separate_r18 show_progress_percent".split())
CHECKPOINTS.add("scan.review.apply")
SETTINGS_KEYS.add("auto_sync")
BOOLEAN_KEYS.add("auto_sync")
TEXT_KEYS = {"language", "theme", "quarantine_dir", "browser", "user_data_dir", "similar_threshold"}
PATH_LIST_KEYS = {"download_roots", "exclude_roots"}


def finite_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def clean_preferences(prefs):
    if not isinstance(prefs, dict):
        raise ValueError("Invalid saved UI preferences")
    result = {key: val for key, val in prefs.items() if key in UI_KEYS}
    for key, value in result.items():
        if value is None:
            continue
        if key in ("similarRoots", "similarExcludes"):
            valid = isinstance(value, str)
        elif key == "librarySort":
            valid = isinstance(value, dict) and value.get("key") in ("created", "modified", "filename", "size", "pixels", "rating") and value.get("direction") in ("asc", "desc")
        elif key.endswith("ColWidths"):
            valid = isinstance(value, dict) and all(finite_number(width) and width > 0 for width in value.values())
        elif key == "windowState":
            valid = isinstance(value, dict) and all(
                type(item) is bool if name == "maximized" else name in ("x", "y", "width", "height") and finite_number(item)
                for name, item in value.items())
        else:
            valid = finite_number(value) and value > 0
        if not valid:
            raise ValueError(f"Invalid saved UI preference: {key}")
    return result


def clean_settings(value):
    if not isinstance(value, dict):
        raise ValueError("Invalid settings in backup")
    result = {key: item for key, item in value.items() if key in SETTINGS_KEYS}
    for key, item in result.items():
        if key == "ui_preferences":
            continue
        if key in BOOLEAN_KEYS:
            valid = type(item) is bool
        elif key in TEXT_KEYS:
            valid = item is None or isinstance(item, str)
        elif key in PATH_LIST_KEYS:
            valid = isinstance(item, list) and all(isinstance(path, str) and "\0" not in path for path in item)
        else:
            valid = item is None or finite_number(item)
        if not valid:
            raise ValueError(f"Invalid setting in backup: {key}")
    for key, allowed in {"theme": ("light", "dark", "system"), "language": ("zh", "en", "ja", "es", "fr", "de"), "similar_threshold": ("likely", "possible")}.items():
        if result.get(key) is not None and result[key] not in allowed:
            raise ValueError(f"Unsupported setting in backup: {key}")
    prefs = result.get("ui_preferences")
    if isinstance(prefs, dict):
        result["ui_preferences"] = clean_preferences(prefs)
    else:
        result.pop("ui_preferences", None)
    return result


def canonical(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def changes(before, after, path=()):
    """Leaf deltas keep unrelated concurrent edits; missing records stay structural."""
    if before == after:
        return []
    if isinstance(before, dict) and isinstance(after, dict):
        result = []
        for key in sorted(before.keys() | after.keys()):
            if key not in before or key not in after:
                result.append({"path": [*path, key], "before": before.get(key), "after": after.get(key),
                               "had_before": key in before, "had_after": key in after})
            else:
                result.extend(changes(before[key], after[key], (*path, key)))
        return result
    return [{"path": list(path), "before": before, "after": after, "had_before": True, "had_after": True}]


def apply_deltas(current, deltas, *, reverse=False):
    current = json.loads(canonical(current))
    expected, wanted = ("after", "before") if reverse else ("before", "after")
    for delta in deltas:
        target = current
        for key in delta["path"][:-1]:
            if not isinstance(target, dict) or key not in target:
                raise ValueError("Undo conflict: a related record changed")
            target = target[key]
        key = delta["path"][-1]
        if (not isinstance(target, dict) or (key in target) != delta["had_" + expected]
                or target.get(key) != delta[expected]):
            raise ValueError("Undo conflict: subsequent changes were preserved")
        if delta["had_" + wanted]:
            target[key] = delta[wanted]
        else:
            target.pop(key, None)
    return current
