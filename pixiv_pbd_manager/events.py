"""Progress event keys emitted across the GUI IPC.

Centralized so the backend (operations.*, similar, downloader, gui_api.runtime)
and the frontend (desktop/src/events.ts) share a single canonical name table.
If a key is renamed here, the mirror in events.ts must move in lockstep — the
frontend switch otherwise silently falls through to the catch-all log
formatter, which is graceful degradation but loses the progress bar.

These string values ARE the wire format. Don't rename them lightly: any
running frontend caching its UI state with old keys would also need an
upgrade path.
"""

from __future__ import annotations


# Local-scan pipeline
PROGRESS_SCAN_START = "progress_scan_start"
PROGRESS_SCAN_FILES = "progress_scan_files"
PROGRESS_SCAN_DONE = "progress_scan_done"
PROGRESS_RESOLVE_ARTIST = "progress_resolve_artist"
PROGRESS_FUZZY_ARTIST = "progress_fuzzy_artist"

# Update check (refresh remote work-id list per artist)
PROGRESS_CHECK_START = "progress_check_start"
PROGRESS_CHECK_ARTIST = "progress_check_artist"
PROGRESS_CHECK_FOUND = "progress_check_found"

# Artist-name refresh (fetch current Pixiv profile names by user id)
PROGRESS_REFRESH_NAMES_START = "progress_refresh_names_start"
PROGRESS_REFRESH_NAMES_ARTIST = "progress_refresh_names_artist"
PROGRESS_REFRESH_NAMES_DONE = "progress_refresh_names_done"

# Download pipeline (multi-artist, multi-work, multi-page)
PROGRESS_DOWNLOAD_START = "progress_download_start"
PROGRESS_DOWNLOAD_ARTIST = "progress_download_artist"
PROGRESS_DOWNLOAD_WORK = "progress_download_work"
PROGRESS_DOWNLOAD_WORK_DONE = "progress_download_work_done"
PROGRESS_DOWNLOAD_ERROR = "progress_download_error"
PROGRESS_DOWNLOAD_FILE_START = "progress_download_file_start"
PROGRESS_DOWNLOAD_FILE_PROGRESS = "progress_download_file_progress"
PROGRESS_DOWNLOAD_FILE_DONE = "progress_download_file_done"

# Similar-image scan
PROGRESS_SIMILAR_START = "progress_similar_start"
PROGRESS_SIMILAR_FILE_START = "progress_similar_file_start"
PROGRESS_SIMILAR_FILES = "progress_similar_files"
PROGRESS_SIMILAR_INDEX_SAVED = "progress_similar_index_saved"
PROGRESS_SIMILAR_MATCH_START = "progress_similar_match_start"
PROGRESS_SIMILAR_MATCH = "progress_similar_match"
PROGRESS_SIMILAR_DONE = "progress_similar_done"

# Image-library catalog scan
PROGRESS_LIBRARY_START = "progress_library_start"
PROGRESS_LIBRARY_FILES = "progress_library_files"
PROGRESS_LIBRARY_DONE = "progress_library_done"

# Fetching Pixiv artwork tags onto library images
PROGRESS_FETCH_TAGS_START = "progress_fetch_tags_start"
PROGRESS_FETCH_TAGS_ITEM = "progress_fetch_tags_item"
PROGRESS_FETCH_TAGS_DONE = "progress_fetch_tags_done"

# Similar-image cleanup / quarantine operations
PROGRESS_CLEANUP_START = "progress_cleanup_start"
PROGRESS_CLEANUP_ITEM = "progress_cleanup_item"
PROGRESS_CLEANUP_DONE = "progress_cleanup_done"
