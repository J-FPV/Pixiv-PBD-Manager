"""High-level workflows that compose scanner/resolver/downloader/database.

The package is split into focused modules; this ``__init__`` re-exports the
public surface so existing callers (``from pixiv_pbd_manager.operations import
scan_into_database``) keep working unchanged after the split.
"""

from ._shared import ProgressCallback, collect_local_work_ids
from .scan import (
    ScanApplyResult,
    ScanPreviewResult,
    ScanResult,
    apply_scan_changes,
    preview_scan_changes,
    scan_into_database,
)
from .updates import DownloadUpdatesResult, UpdateCheckResult, check_artist_updates, download_artist_updates


__all__ = [
    "ProgressCallback",
    "collect_local_work_ids",
    "ScanResult",
    "ScanPreviewResult",
    "ScanApplyResult",
    "scan_into_database",
    "preview_scan_changes",
    "apply_scan_changes",
    "UpdateCheckResult",
    "DownloadUpdatesResult",
    "check_artist_updates",
    "download_artist_updates",
]
