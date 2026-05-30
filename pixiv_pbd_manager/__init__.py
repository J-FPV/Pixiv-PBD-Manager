"""Local helper for managing Pixiv artists downloaded through PBD.

The names re-exported below are the stable public surface — code embedding
this package as a library should import them from the package root:

    from pixiv_pbd_manager import scan_into_database, ArtistDatabase

Anything not re-exported here is implementation detail (scanner heuristics,
resolver HTTP plumbing, downloader CDN logic, GUI IPC wiring, CLI argparse
glue, etc.). It can still be reached via ``pixiv_pbd_manager.<module>`` but
makes no compatibility promises across versions.
"""

from .database import ArtistDatabase
from .models import ArtistRecord
from .operations import (
    DownloadUpdatesResult,
    ScanApplyResult,
    ScanPreviewResult,
    ScanResult,
    UpdateCheckResult,
    apply_scan_changes,
    check_artist_updates,
    collect_local_work_ids,
    download_artist_updates,
    preview_scan_changes,
    scan_into_database,
)


__version__ = "0.1.4"

__all__ = [
    "__version__",
    # Data model
    "ArtistDatabase",
    "ArtistRecord",
    # Workflow result types
    "ScanResult",
    "ScanPreviewResult",
    "ScanApplyResult",
    "UpdateCheckResult",
    "DownloadUpdatesResult",
    # Workflow entry points
    "scan_into_database",
    "preview_scan_changes",
    "apply_scan_changes",
    "check_artist_updates",
    "download_artist_updates",
    "collect_local_work_ids",
]
