from __future__ import annotations

import json
import re
import ssl
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

from .resolver import (
    PIXIV_BROWSER_USER_AGENT,
    PixivResolveError,
    is_ssl_certificate_error,
    read_url_text_with_ssl_fallback,
)


PIXIV_ILLUST_PAGES_URL = "https://www.pixiv.net/ajax/illust/{work_id}/pages"
SAFE_FILENAME_PATTERN = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


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
    for index, page in enumerate(raw.get("body") or []):
        urls = page.get("urls") or {}
        original_url = urls.get("original")
        if original_url:
            pages.append(PixivPage(index=index, original_url=str(original_url)))
    return pages, ssl_fallback_used


def download_binary(
    url: str,
    output: Path,
    *,
    referer: str,
    allow_insecure_ssl_fallback: bool = True,
) -> bool:
    # Deliberately does NOT send the Pixiv session cookie. The i.pximg.net image CDN only
    # checks Referer; forwarding PHPSESSID to it would leak the session to the CDN.
    headers = {
        "User-Agent": PIXIV_BROWSER_USER_AGENT,
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Referer": referer,
    }
    request = urllib.request.Request(url, headers=headers)

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            output.write_bytes(response.read())
            return False
    except urllib.error.URLError as exc:
        if not allow_insecure_ssl_fallback or not is_ssl_certificate_error(exc):
            raise
        with urllib.request.urlopen(request, timeout=30, context=ssl._create_unverified_context()) as response:
            output.write_bytes(response.read())
            return True


def download_artwork(
    work_id: str,
    target_dir: Path,
    *,
    pixiv_cookie: str | None = None,
    allow_insecure_ssl_fallback: bool = True,
    overwrite: bool = False,
    delay_seconds: float = 0.3,
) -> ArtworkDownloadResult:
    result = ArtworkDownloadResult(work_id=str(work_id))
    target_dir.mkdir(parents=True, exist_ok=True)

    try:
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
            ssl_used = download_binary(
                page.original_url,
                output,
                referer=f"https://www.pixiv.net/artworks/{work_id}",
                allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
            )
            result.ssl_fallback_used = result.ssl_fallback_used or ssl_used
            result.saved_files.append(str(output))
            if delay_seconds > 0:
                time.sleep(delay_seconds)
    except (OSError, urllib.error.URLError, PixivResolveError) as exc:
        result.error = str(exc)
    return result
