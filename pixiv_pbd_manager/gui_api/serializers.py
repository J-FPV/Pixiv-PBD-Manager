"""Pure functions that turn backend dataclasses into JSON-safe dicts.

Kept separate from command handlers so the wire format is obvious and easy to
audit in one place.
"""

from __future__ import annotations

from ..models import ArtistRecord
from ..operations import DownloadUpdatesResult, ScanResult, UpdateCheckResult
from ..similar import SimilarGroup, SimilarImageResult
from .runtime import JsonDict


def artist_to_json(artist: ArtistRecord) -> JsonDict:
    return {
        "id": artist.id,
        "name": artist.name or "",
        "pixiv_url": artist.pixiv_url,
        "works": len(artist.work_ids),
        "new_works": len(artist.new_work_ids),
        "work_ids": list(artist.work_ids),
        "new_work_ids": list(artist.new_work_ids),
        "save_paths": list(artist.save_paths),
        "download_roots": list(artist.download_roots),
        "last_seen": artist.last_seen,
        "last_checked": artist.last_checked,
        "last_opened": artist.last_opened or "",
        "notes": artist.notes,
        "favorite": artist.favorite,
        "tags": sorted(set(artist.tags)),
    }


def scan_result_to_json(result: ScanResult) -> JsonDict:
    summary = result.summary
    unmatched = sorted(summary.unmatched_folders.items(), key=lambda item: (-item[1], item[0]))
    return {
        "files_seen": summary.files_seen,
        "files_matched": summary.files_matched,
        "excluded_dirs": summary.excluded_dirs,
        "artists": len(summary.artists),
        "name_only_artists": len(summary.name_only_artists),
        "changed": result.changed,
        "resolved_name_only": result.resolved_name_only,
        "fuzzy_resolved_name_only": result.fuzzy_resolved_name_only,
        "ssl_fallback_used": result.ssl_fallback_used,
        "resolve_errors": list(result.resolve_errors),
        "db_path": str(result.db_path),
        "unmatched_folders": [{"path": path, "count": count} for path, count in unmatched],
    }


def update_result_to_json(result: UpdateCheckResult) -> JsonDict:
    return {
        "checked": result.checked,
        "artists_with_updates": result.artists_with_updates,
        "new_works": result.new_works,
        "ssl_fallback_used": result.ssl_fallback_used,
        "errors": list(result.errors),
    }


def download_result_to_json(result: DownloadUpdatesResult) -> JsonDict:
    return {
        "artists": result.artists,
        "artworks": result.artworks,
        "pages_saved": result.pages_saved,
        "files_skipped": result.files_skipped,
        "ssl_fallback_used": result.ssl_fallback_used,
        "errors": list(result.errors),
    }


def similar_group_to_json(group: SimilarGroup) -> JsonDict:
    return {
        "id": group.id,
        "kind": group.kind,
        "best_phash_distance": group.best_phash_distance,
        "best_dhash_distance": group.best_dhash_distance,
        "entries": [
            {
                "path": entry.path,
                "size_bytes": entry.size_bytes,
                "mtime_ns": entry.mtime_ns,
                "width": entry.width,
                "height": entry.height,
                "resolution": entry.resolution,
                "sha256": entry.sha256,
                "phash": entry.phash,
                "dhash": entry.dhash,
            }
            for entry in group.entries
        ],
    }


def similar_result_to_json(result: SimilarImageResult) -> JsonDict:
    return {
        "roots": result.roots,
        "index_path": str(result.index_path),
        "files_seen": result.files_seen,
        "indexed": result.indexed,
        "reused": result.reused,
        "changed": result.changed,
        "error_count": result.error_count,
        "errors": list(result.errors),
        "groups": [similar_group_to_json(group) for group in result.groups],
    }
