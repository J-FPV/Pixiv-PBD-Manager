// Mirror of pixiv_pbd_manager/events.py. Renaming a key requires editing
// both files: the IPC contract is the literal string value, not a generated
// stub. If the two drift, the switch in utils/progressEvents.ts falls
// through to the catch-all log line — graceful degradation, but the progress
// bar will stop updating for that key.

// Local-scan pipeline
export const PROGRESS_SCAN_START = "progress_scan_start";
export const PROGRESS_SCAN_FILES = "progress_scan_files";
export const PROGRESS_SCAN_DONE = "progress_scan_done";
export const PROGRESS_RESOLVE_ARTIST = "progress_resolve_artist";
export const PROGRESS_FUZZY_ARTIST = "progress_fuzzy_artist";

// Update check
export const PROGRESS_CHECK_START = "progress_check_start";
export const PROGRESS_CHECK_ARTIST = "progress_check_artist";
export const PROGRESS_CHECK_FOUND = "progress_check_found";

// Artist-name refresh
export const PROGRESS_REFRESH_NAMES_START = "progress_refresh_names_start";
export const PROGRESS_REFRESH_NAMES_ARTIST = "progress_refresh_names_artist";
export const PROGRESS_REFRESH_NAMES_DONE = "progress_refresh_names_done";

// Download pipeline
export const PROGRESS_DOWNLOAD_START = "progress_download_start";
export const PROGRESS_DOWNLOAD_ARTIST = "progress_download_artist";
export const PROGRESS_DOWNLOAD_WORK = "progress_download_work";
export const PROGRESS_DOWNLOAD_WORK_DONE = "progress_download_work_done";
export const PROGRESS_DOWNLOAD_ERROR = "progress_download_error";
export const PROGRESS_DOWNLOAD_FILE_START = "progress_download_file_start";
export const PROGRESS_DOWNLOAD_FILE_PROGRESS = "progress_download_file_progress";
export const PROGRESS_DOWNLOAD_FILE_DONE = "progress_download_file_done";

// Similar-image scan
export const PROGRESS_SIMILAR_START = "progress_similar_start";
export const PROGRESS_SIMILAR_FILE_START = "progress_similar_file_start";
export const PROGRESS_SIMILAR_FILES = "progress_similar_files";
export const PROGRESS_SIMILAR_INDEX_SAVED = "progress_similar_index_saved";
export const PROGRESS_SIMILAR_MATCH_START = "progress_similar_match_start";
export const PROGRESS_SIMILAR_MATCH = "progress_similar_match";
export const PROGRESS_SIMILAR_DONE = "progress_similar_done";

// Image-library catalog scan
export const PROGRESS_LIBRARY_START = "progress_library_start";
export const PROGRESS_LIBRARY_FILES = "progress_library_files";
export const PROGRESS_LIBRARY_DONE = "progress_library_done";

// Similar-image cleanup / quarantine operations
export const PROGRESS_CLEANUP_START = "progress_cleanup_start";
export const PROGRESS_CLEANUP_ITEM = "progress_cleanup_item";
export const PROGRESS_CLEANUP_DONE = "progress_cleanup_done";
