import { ARTISTS_COL_WIDTHS_KEY, LIBRARY_SIDEBAR_WIDTH_KEY, SIMILAR_COL_WIDTHS_KEY,
  UI_STATE_KEY, UNMATCHED_COL_WIDTHS_KEY, WINDOW_STATE_KEY } from "../constants";
import { loadJson, persistJson } from "./storage";
import { normalizeLibrarySort } from "./librarySort";
import { clampTextareaHeight } from "./textarea";

const UI_KEYS = ["librarySort", "similarRoots", "similarExcludes", "similarRootBoxHeight", "similarExcludeBoxHeight"];
const STORAGE_KEYS: Record<string, string> = {
  librarySidebarWidth: LIBRARY_SIDEBAR_WIDTH_KEY, artistsColWidths: ARTISTS_COL_WIDTHS_KEY,
  unmatchedColWidths: UNMATCHED_COL_WIDTHS_KEY, similarColWidths: SIMILAR_COL_WIDTHS_KEY, windowState: WINDOW_STATE_KEY
};
export function collectPreferences(): Record<string, unknown> {
  const ui = loadJson<Record<string, unknown>>(UI_STATE_KEY, {});
  const result: Record<string, unknown> = {};
  UI_KEYS.forEach((key) => { if (key in ui) result[key] = ui[key]; });
  Object.entries(STORAGE_KEYS).forEach(([key, storage]) => {
    const value = loadJson<unknown>(storage, null);
    if (value !== null) result[key] = value;
  });
  return result;
}
export function applyPreferences(prefs: Record<string, unknown>) {
  const ui = loadJson<Record<string, unknown>>(UI_STATE_KEY, {});
  ui.librarySort = normalizeLibrarySort(prefs.librarySort);
  for (const key of ["similarRoots", "similarExcludes"]) ui[key] = typeof prefs[key] === "string" ? prefs[key] : "";
  for (const key of ["similarRootBoxHeight", "similarExcludeBoxHeight"]) ui[key] = clampTextareaHeight(prefs[key]);
  persistJson(UI_STATE_KEY, ui);
  Object.entries(STORAGE_KEYS).forEach(([key, storage]) => {
    const value = prefs[key];
    if (key === "librarySidebarWidth") persistJson(storage, typeof value === "number" ? Math.max(160, Math.min(600, value)) : null);
    else persistJson(storage, value && typeof value === "object" ? value : null);
  });
}
