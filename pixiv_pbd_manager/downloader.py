from __future__ import annotations

import json
import re
import ssl
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

from .events import (
    PROGRESS_DOWNLOAD_FILE_DONE,
    PROGRESS_DOWNLOAD_FILE_PROGRESS,
    PROGRESS_DOWNLOAD_FILE_START,
)
from .resolver import (
    PIXIV_BROWSER_USER_AGENT,
    PixivResolveError,
    fetch_artwork_xrestrict,
    is_ssl_certificate_error,
    read_url_text_with_ssl_fallback,
)


PIXIV_ILLUST_PAGES_URL = "https://www.pixiv.net/ajax/illust/{work_id}/pages"
SAFE_FILENAME_PATTERN = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
RESTRICTED_SUBDIR = "[R-18&R-18G]"
# Pixiv serves these placeholder images (instead of the real artwork) when a
# restricted/login-only work is requested without a valid session cookie. We
# must NOT treat them as a successful download, otherwise the work would be
# recorded as "got" and disappear from the artist's available-updates count.
RESTRICTED_PLACEHOLDER_MARKERS = ("limit_unknown", "limit_sanity_level", "limit_mypixiv")
ProgressCallback = Callable[[str, dict[str, object]], None]


def _is_restricted_placeholder(url: str) -> bool:
    return any(marker in url for marker in RESTRICTED_PLACEHOLDER_MARKERS)


@dataclass(frozen=True)
class PixivPage:
    index: int
    original_url: str


@dataclass
class ArtworkDownloadResult:
    work_id: str
    saved_files: list[str] = field(default_factory=list)
    skipped_files: list[str] = field(default_factory=list)
    error: str | None = None
    ssl_fallback_used: bool = False

    @property
    def ok(self) -> bool:
        return self.error is None


def safe_filename(value: str) -> str:
    value = SAFE_FILENAME_PATTERN.sub("_", value).strip(" .")
    return value or "untitled"


def extension_from_url(url: str) -> str:
    suffix = Path(urlparse(url).path).suffix
    return suffix if suffix else ".jpg"


def fetch_artwork_pages(
    work_id: str,
    *,
    pixiv_cookie: str | None = None,
    allow_insecure_ssl_fallback: bool = True,
) -> tuple[list[PixivPage], bool]:
    url = PIXIV_ILLUST_PAGES_URL.format(work_id=work_id)
    try:
        raw_text, ssl_fallback_used = read_url_text_with_ssl_fallback(
            url,
            cookie=pixiv_cookie,
            referer=f"https://www.pixiv.net/artworks/{work_id}",
            accept="application/json, text/plain, */*",
            allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
        )
    except (urllib.error.URLError, TimeoutError) as exc:
        raise PixivResolveError(f"Pixiv pages request failed for artwork {work_id}: {exc}") from exc

    try:
        raw = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise PixivResolveError(f"Pixiv pages request failed for artwork {work_id}: invalid JSON") from exc
    if raw.get("error"):
        message = str(raw.get("message") or "").strip() or "API returned error"
        raise PixivResolveError(f"Pixiv pages request failed for artwork {work_id}: {message}")

    pages: list[PixivPage] = []
    restricted_placeholder_seen = False
    for index, page in enumerate(raw.get("body") or []):
        urls = page.get("urls") or {}
        original_url = urls.get("original")
        if not original_url:
            continue
        if _is_restricted_placeholder(str(original_url)):
            restricted_placeholder_seen = True
            continue
        pages.append(PixivPage(index=index, original_url=str(original_url)))
    if not pages and restricted_placeholder_seen:
        raise PixivResolveError(
            f"Artwork {work_id} is restricted (R-18/login-only); a logged-in Pixiv cookie is required to download it"
        )
    return pages, ssl_fallback_used


def download_binary(
    url: str,
    output: Path,
    *,
    referer: str,
    allow_insecure_ssl_fallback: bool = True,
    progress_callback: Callable[[int, int | None, float], None] | None = None,
) -> bool:
    # Deliberately does NOT send the Pixiv session cookie. The i.pximg.net image CDN only
    # checks Referer; forwarding PHPSESSID to it would leak the session to the CDN.
    headers = {
        "User-Agent": PIXIV_BROWSER_USER_AGENT,
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Referer": referer,
    }
    request = urllib.request.Request(url, headers=headers)

    def stream(context: ssl.SSLContext | None) -> None:
        temp_output = output.with_name(f"{output.name}.part")
        try:
            with urllib.request.urlopen(request, timeout=30, context=context) as response:
                raw_total = response.headers.get("Content-Length")
                try:
                    total = int(raw_total) if raw_total else None
                except ValueError:
                    total = None
                downloaded = 0
                started = time.monotonic()
                with temp_output.open("wb") as handle:
                    while True:
                        chunk = response.read(256 * 1024)
                        if not chunk:
                            break
                        handle.write(chunk)
                        downloaded += len(chunk)
                        elapsed = max(time.monotonic() - started, 0.001)
                        if progress_callback:
                            progress_callback(downloaded, total, downloaded / elapsed)
                temp_output.replace(output)
        except Exception:
            try:
                temp_output.unlink()
            except OSError:
                pass
            raise

    try:
        stream(None)
        return False
    except urllib.error.URLError as exc:
        if not allow_insecure_ssl_fallback or not is_ssl_certificate_error(exc):
            raise
        stream(ssl._create_unverified_context())
        return True


def download_artwork(
    work_id: str,
    target_dir: Path,
    *,
    pixiv_cookie: str | None = None,
    allow_insecure_ssl_fallback: bool = True,
    overwrite: bool = False,
    delay_seconds: float = 0.3,
    separate_restricted: bool = False,
    progress_callback: ProgressCallback | None = None,
) -> ArtworkDownloadResult:
    result = ArtworkDownloadResult(work_id=str(work_id))
    target_dir.mkdir(parents=True, exist_ok=True)

    try:
        if separate_restricted:
            xrestrict, ssl_used = fetch_artwork_xrestrict(
                str(work_id),
                cookie=pixiv_cookie,
                allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
            )
            result.ssl_fallback_used = result.ssl_fallback_used or ssl_used
            if xrestrict in (1, 2):
                target_dir = target_dir / RESTRICTED_SUBDIR
                target_dir.mkdir(parents=True, exist_ok=True)

        pages, ssl_fallback_used = fetch_artwork_pages(
            str(work_id),
            pixiv_cookie=pixiv_cookie,
            allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
        )
        result.ssl_fallback_used = result.ssl_fallback_used or ssl_fallback_used
        if not pages:
            result.error = "no downloadable pages"
            return result

        for page in pages:
            filename = safe_filename(f"{work_id}_p{page.index}{extension_from_url(page.original_url)}")
            output = target_dir / filename
            if output.exists() and not overwrite:
                result.skipped_files.append(str(output))
                continue
            if progress_callback:
                progress_callback(
                    PROGRESS_DOWNLOAD_FILE_START,
                    {
                        "work_id": str(work_id),
                        "page": page.index,
                        "filename": filename,
                        "downloaded_bytes": 0,
                        "total_bytes": 0,
                        "speed_bps": 0.0,
                    },
                )

            def on_binary_progress(downloaded: int, total: int | None, speed_bps: float) -> None:
                if progress_callback:
                    progress_callback(
                        PROGRESS_DOWNLOAD_FILE_PROGRESS,
                        {
                            "work_id": str(work_id),
                            "page": page.index,
                            "filename": filename,
                            "downloaded_bytes": downloaded,
                            "total_bytes": total or 0,
                            "speed_bps": speed_bps,
                        },
                    )

            ssl_used = download_binary(
                page.original_url,
                output,
                referer=f"https://www.pixiv.net/artworks/{work_id}",
                allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
                progress_callback=on_binary_progress,
            )
            result.ssl_fallback_used = result.ssl_fallback_used or ssl_used
            result.saved_files.append(str(output))
            if progress_callback:
                size = output.stat().st_size if output.exists() else 0
                progress_callback(
                    PROGRESS_DOWNLOAD_FILE_DONE,
                    {
                        "work_id": str(work_id),
                        "page": page.index,
                        "filename": filename,
                        "downloaded_bytes": size,
                        "total_bytes": size,
                        "speed_bps": 0.0,
                    },
                )
            if delay_seconds > 0:
                time.sleep(delay_seconds)
    except (OSError, urllib.error.URLError, PixivResolveError) as exc:
        result.error = str(exc)
    return result
