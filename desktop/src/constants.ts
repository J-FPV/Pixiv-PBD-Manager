import type { AppSettings } from "./types";

// Default settings used when the backend has not yet returned a settings.get payload.
export const DEFAULT_SETTINGS: AppSettings = {
  language: "zh",
  database: ".pixiv-pbd-manager/artists.json",
  download_roots: [],
  exclude_roots: [],
  delay: 1,
  limit: 10,
  watch_interval: 30,
  resolve_online: true,
  resolve_limit: 3,
  fuzzy_search: false,
  fuzzy_min_score: 0.35,
  ssl_fallback: true,
  similar_threshold: "likely",
  similar_skip_pixiv_pages: false,
  scan_local_subfolders: false,
  scan_max_depth: -1,
  scan_recognize_low_pids: false,
  update_check_depth: 0,
  update_check_pages: 0,
  separate_r18: false,
  show_progress_percent: true
};

// LocalStorage keys. Versioned so we can change shapes without crashing old installs.
export const UI_STATE_KEY = "pixiv-pbd-manager.uiState.v1";
export const WINDOW_STATE_KEY = "pixiv-pbd-manager.windowState.v1";
export const UNMATCHED_CACHE_KEY = "pixiv-pbd-manager.unmatchedFolders.v1";
export const SIMILAR_RESULT_CACHE_KEY = "pixiv-pbd-manager.similarResult.v1";
export const ARTISTS_COL_WIDTHS_KEY = "pixiv-pbd-manager.artistsColWidths.v1";
export const UNMATCHED_COL_WIDTHS_KEY = "pixiv-pbd-manager.unmatchedColWidths.v1";
export const SIMILAR_COL_WIDTHS_KEY = "pixiv-pbd-manager.similarColWidths.v1";
