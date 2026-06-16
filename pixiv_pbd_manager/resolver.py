from __future__ import annotations

from collections import Counter
import difflib
import html
import json
import re
import ssl
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from .scanner import NameOnlyArtistHit


PIXIV_AJAX_ILLUST_URL = "https://www.pixiv.net/ajax/illust/{illust_id}"
PIXIV_USER_PROFILE_URL = "https://www.pixiv.net/ajax/user/{user_id}"
PIXIV_USER_PROFILE_ALL_URL = "https://www.pixiv.net/ajax/user/{user_id}/profile/all"
PIXIV_USER_SEARCH_URL = "https://www.pixiv.net/search/users?s_mode=s_usr&nick={keyword}&i=1&comment=&p=1"
PIXIV_PROFILE_WORKS_PER_PAGE = 48
PIXIV_BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
)
USER_LINK_PATTERN = re.compile(r"/users/(?P<id>\d+)")
SCRIPT_JSON_PATTERN = re.compile(r"<script[^>]*type=[\"']application/json[\"'][^>]*>(?P<body>.*?)</script>", re.S | re.I)
INLINE_USER_PATTERNS = [
    re.compile(r'"userId"\s*:\s*"?(\d+)"?.{0,300}?"userName"\s*:\s*"((?:\\.|[^"\\])*)"', re.S),
    re.compile(r'"userId"\s*:\s*"?(\d+)"?.{0,300}?"name"\s*:\s*"((?:\\.|[^"\\])*)"', re.S),
    re.compile(r'"id"\s*:\s*"?(\d{3,12})"?.{0,300}?"name"\s*:\s*"((?:\\.|[^"\\])*)"', re.S),
]


@dataclass(frozen=True)
class ResolvedArtist:
    id: str
    name: str
    work_id: str
    ssl_fallback_used: bool = False


@dataclass(frozen=True)
class PixivUserCandidate:
    id: str
    name: str
    score: float
    source: str
    ssl_fallback_used: bool = False


@dataclass(frozen=True)
class PixivUserWorks:
    user_id: str
    work_ids: set[str]
    ssl_fallback_used: bool = False


@dataclass(frozen=True)
class PixivUserProfile:
    id: str
    name: str
    ssl_fallback_used: bool = False


@dataclass(frozen=True)
class ArtworkTag:
    tag: str
    translation: str = ""


class PixivResolveError(RuntimeError):
    pass


def parse_user_work_ids_from_profile_all(raw: dict, max_pages: int | None = None) -> set[str]:
    body = raw.get("body") or {}
    work_ids: set[str] = set()
    for key in ("illusts", "manga"):
        value = body.get(key) or {}
        if isinstance(value, dict):
            candidates = value.keys()
        elif isinstance(value, list):
            candidates = value
        else:
            continue
        work_ids.update(str(work_id) for work_id in candidates if str(work_id).isdigit())

    ordered = sorted(work_ids, key=lambda value: int(value), reverse=True)
    if max_pages and max_pages > 0:
        ordered = ordered[: max_pages * PIXIV_PROFILE_WORKS_PER_PAGE]
    return set(ordered)


def is_ssl_certificate_error(exc: BaseException) -> bool:
    reason = getattr(exc, "reason", exc)
    return isinstance(reason, ssl.SSLCertVerificationError) or "CERTIFICATE_VERIFY_FAILED" in str(exc)


def read_pixiv_json(
    illust_id: str,
    *,
    timeout: float,
    cookie: str | None,
    context: ssl.SSLContext | None,
) -> dict:
    headers = {
        "User-Agent": PIXIV_BROWSER_USER_AGENT,
        "Accept": "application/json, text/plain, */*",
        "Referer": f"https://www.pixiv.net/artworks/{illust_id}",
    }
    if cookie:
        headers["Cookie"] = cookie

    request = urllib.request.Request(PIXIV_AJAX_ILLUST_URL.format(illust_id=illust_id), headers=headers)
    with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
        return json.loads(response.read().decode("utf-8"))


def read_url_text(
    url: str,
    *,
    timeout: float,
    cookie: str | None,
    referer: str,
    context: ssl.SSLContext | None,
    accept: str = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
) -> str:
    headers = {
        "User-Agent": PIXIV_BROWSER_USER_AGENT,
        "Accept": accept,
        "Referer": referer,
    }
    if cookie:
        headers["Cookie"] = cookie
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
        return response.read().decode("utf-8", errors="replace")


def read_url_text_with_ssl_fallback(
    url: str,
    *,
    timeout: float = 15.0,
    cookie: str | None = None,
    referer: str = "https://www.pixiv.net/",
    accept: str = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    allow_insecure_ssl_fallback: bool = True,
) -> tuple[str, bool]:
    try:
        return read_url_text(url, timeout=timeout, cookie=cookie, referer=referer, context=None, accept=accept), False
    except urllib.error.URLError as exc:
        if not allow_insecure_ssl_fallback or not is_ssl_certificate_error(exc):
            raise
        return (
            read_url_text(
                url,
                timeout=timeout,
                cookie=cookie,
                referer=referer,
                context=ssl._create_unverified_context(),
                accept=accept,
            ),
            True,
        )


def fetch_artwork_author(
    illust_id: str,
    *,
    timeout: float = 15.0,
    cookie: str | None = None,
    allow_insecure_ssl_fallback: bool = True,
) -> ResolvedArtist | None:
    ssl_fallback_used = False
    try:
        raw = read_pixiv_json(illust_id, timeout=timeout, cookie=cookie, context=None)
    except urllib.error.HTTPError as exc:
        if exc.code in {403, 404}:
            return None
        raise PixivResolveError(f"Pixiv request failed for artwork {illust_id}: HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        if not allow_insecure_ssl_fallback or not is_ssl_certificate_error(exc):
            raise PixivResolveError(f"Pixiv request failed for artwork {illust_id}: {exc}") from exc
        ssl_fallback_used = True
        try:
            raw = read_pixiv_json(
                illust_id,
                timeout=timeout,
                cookie=cookie,
                context=ssl._create_unverified_context(),
            )
        except urllib.error.HTTPError as retry_exc:
            if retry_exc.code in {403, 404}:
                return None
            raise PixivResolveError(f"Pixiv request failed for artwork {illust_id}: HTTP {retry_exc.code}") from retry_exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as retry_exc:
            raise PixivResolveError(f"Pixiv request failed for artwork {illust_id}: {retry_exc}") from retry_exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise PixivResolveError(f"Pixiv request failed for artwork {illust_id}: {exc}") from exc

    if raw.get("error"):
        return None
    body = raw.get("body") or {}
    artist_id = str(body.get("userId") or "")
    artist_name = str(body.get("userName") or "")
    if not artist_id.isdigit():
        return None
    return ResolvedArtist(id=artist_id, name=artist_name, work_id=str(illust_id), ssl_fallback_used=ssl_fallback_used)


def fetch_artwork_xrestrict(
    illust_id: str,
    *,
    timeout: float = 15.0,
    cookie: str | None = None,
    allow_insecure_ssl_fallback: bool = True,
) -> tuple[int, bool]:
    """Return ``(xRestrict, ssl_fallback_used)``.

    ``xRestrict`` is 0 for all-ages, 1 for R-18, 2 for R-18G, and -1 when it
    cannot be determined (network/auth error). A failure here must never abort a
    download, so the unknown case is reported instead of raised.
    """
    ssl_fallback_used = False
    try:
        raw = read_pixiv_json(illust_id, timeout=timeout, cookie=cookie, context=None)
    except urllib.error.URLError as exc:
        retriable = (
            allow_insecure_ssl_fallback
            and not isinstance(exc, urllib.error.HTTPError)
            and is_ssl_certificate_error(exc)
        )
        if not retriable:
            return -1, ssl_fallback_used
        ssl_fallback_used = True
        try:
            raw = read_pixiv_json(
                illust_id,
                timeout=timeout,
                cookie=cookie,
                context=ssl._create_unverified_context(),
            )
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            return -1, ssl_fallback_used
    except (TimeoutError, json.JSONDecodeError):
        return -1, ssl_fallback_used

    if raw.get("error"):
        return -1, ssl_fallback_used
    body = raw.get("body") or {}
    try:
        return int(body.get("xRestrict", 0) or 0), ssl_fallback_used
    except (TypeError, ValueError):
        return -1, ssl_fallback_used


def fetch_artwork_tags(
    illust_id: str,
    *,
    timeout: float = 15.0,
    cookie: str | None = None,
    allow_insecure_ssl_fallback: bool = True,
) -> tuple[list[ArtworkTag], bool]:
    """Return ``(tags, ssl_fallback_used)`` for one artwork.

    Each tag carries Pixiv's original text plus its English translation when
    Pixiv provides one. Raises ``PixivResolveError`` when the artwork can't be
    read (network error, or a restricted/login-only work the current cookie
    can't see) so the caller can report it per-PID without aborting a batch.
    """
    ssl_fallback_used = False
    try:
        raw = read_pixiv_json(illust_id, timeout=timeout, cookie=cookie, context=None)
    except urllib.error.HTTPError as exc:
        raise PixivResolveError(f"Pixiv tags request failed for artwork {illust_id}: HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        if not allow_insecure_ssl_fallback or not is_ssl_certificate_error(exc):
            raise PixivResolveError(f"Pixiv tags request failed for artwork {illust_id}: {exc}") from exc
        ssl_fallback_used = True
        try:
            raw = read_pixiv_json(
                illust_id,
                timeout=timeout,
                cookie=cookie,
                context=ssl._create_unverified_context(),
            )
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as retry_exc:
            raise PixivResolveError(f"Pixiv tags request failed for artwork {illust_id}: {retry_exc}") from retry_exc
    except (TimeoutError, json.JSONDecodeError) as exc:
        raise PixivResolveError(f"Pixiv tags request failed for artwork {illust_id}: {exc}") from exc

    if raw.get("error"):
        message = str(raw.get("message") or "").strip() or "artwork is restricted or unavailable"
        raise PixivResolveError(f"Pixiv tags unavailable for artwork {illust_id}: {message}")
    body = raw.get("body") or {}
    raw_tags = ((body.get("tags") or {}).get("tags")) or []
    tags: list[ArtworkTag] = []
    seen: set[str] = set()
    for entry in raw_tags:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("tag") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        translation = str((entry.get("translation") or {}).get("en") or "").strip()
        tags.append(ArtworkTag(tag=name, translation=translation))
    return tags, ssl_fallback_used


def resolve_name_only_artist(
    hit: NameOnlyArtistHit,
    *,
    max_work_ids: int = 3,
    delay_seconds: float = 0.8,
    cookie: str | None = None,
    allow_insecure_ssl_fallback: bool = True,
) -> ResolvedArtist | None:
    work_ids = sorted(hit.work_ids, key=int, reverse=True)
    resolved_items: list[ResolvedArtist] = []
    last_error: PixivResolveError | None = None
    for index, work_id in enumerate(work_ids[:max_work_ids]):
        try:
            resolved = fetch_artwork_author(
                work_id,
                cookie=cookie,
                allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
            )
        except PixivResolveError as exc:
            # One inaccessible/deleted/restricted PID should not sink the whole
            # folder if later files can still identify a consistent author.
            last_error = exc
            resolved = None
        if resolved:
            resolved_items.append(resolved)
        if index != min(len(work_ids), max_work_ids) - 1 and delay_seconds > 0:
            time.sleep(delay_seconds)
    if not resolved_items:
        if last_error is not None:
            raise last_error
        return None

    votes = Counter(item.id for item in resolved_items)
    ranked = votes.most_common()
    if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
        return None
    winning_id = ranked[0][0]
    if len(ranked) > 1 and ranked[0][1] < 2:
        return None
    return next(item for item in resolved_items if item.id == winning_id)


def normalize_search_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return "".join(character for character in normalized if character.isalnum())


def search_name_variants(value: str) -> set[str]:
    variants = {normalize_search_text(value)}
    for part in re.split(r"[@＠|｜/／]", unicodedata.normalize("NFKC", value)):
        normalized = normalize_search_text(part)
        if normalized:
            variants.add(normalized)
    return {item for item in variants if item}


def json_string(value: str) -> str:
    try:
        return json.loads(f'"{value}"')
    except json.JSONDecodeError:
        return html.unescape(value)


def candidate_score(keyword: str, name: str) -> float:
    keys = search_name_variants(keyword)
    values = search_name_variants(name)
    if not keys or not values:
        return 0.0
    best = 0.0
    for key in keys:
        for value in values:
            if key == value:
                return 1.0
            score = difflib.SequenceMatcher(None, key, value).ratio()
            if key in value or value in key:
                score = max(score, 0.82)
            best = max(best, score)
    return best


def collect_user_candidates_from_json(data: Any, keyword: str, out: dict[str, PixivUserCandidate]) -> None:
    if isinstance(data, dict):
        raw_id = data.get("userId") or data.get("id")
        raw_name = data.get("userName") or data.get("name")
        if raw_id and raw_name and str(raw_id).isdigit():
            artist_id = str(raw_id)
            name = str(raw_name)
            score = candidate_score(keyword, name)
            existing = out.get(artist_id)
            if not existing or score > existing.score:
                out[artist_id] = PixivUserCandidate(id=artist_id, name=name, score=score, source="search_json")
        for value in data.values():
            collect_user_candidates_from_json(value, keyword, out)
    elif isinstance(data, list):
        for value in data:
            collect_user_candidates_from_json(value, keyword, out)


def parse_user_search_html(raw_html: str, keyword: str, ssl_fallback_used: bool) -> list[PixivUserCandidate]:
    candidates: dict[str, PixivUserCandidate] = {}
    decoded_html = html.unescape(raw_html)

    for match in SCRIPT_JSON_PATTERN.finditer(decoded_html):
        body = html.unescape(match.group("body")).strip()
        if not body:
            continue
        try:
            collect_user_candidates_from_json(json.loads(body), keyword, candidates)
        except json.JSONDecodeError:
            continue

    for pattern in INLINE_USER_PATTERNS:
        for match in pattern.finditer(decoded_html):
            artist_id = match.group(1)
            name = json_string(match.group(2))
            score = candidate_score(keyword, name)
            existing = candidates.get(artist_id)
            if not existing or score > existing.score:
                candidates[artist_id] = PixivUserCandidate(id=artist_id, name=name, score=score, source="search_inline")

    for match in USER_LINK_PATTERN.finditer(decoded_html):
        artist_id = match.group("id")
        candidates.setdefault(
            artist_id,
            PixivUserCandidate(id=artist_id, name="", score=0.0, source="search_link"),
        )

    return [
        PixivUserCandidate(
            id=item.id,
            name=item.name,
            score=item.score,
            source=item.source,
            ssl_fallback_used=ssl_fallback_used,
        )
        for item in sorted(candidates.values(), key=lambda candidate: candidate.score, reverse=True)
    ]


def search_pixiv_users(
    keyword: str,
    *,
    limit: int = 5,
    min_score: float = 0.35,
    timeout: float = 15.0,
    cookie: str | None = None,
    allow_insecure_ssl_fallback: bool = True,
) -> list[PixivUserCandidate]:
    keyword = keyword.strip()
    if not keyword:
        return []
    encoded_keyword = urllib.parse.quote(keyword)
    url = PIXIV_USER_SEARCH_URL.format(keyword=encoded_keyword)
    try:
        raw_html, ssl_fallback_used = read_url_text_with_ssl_fallback(
            url,
            timeout=timeout,
            cookie=cookie,
            referer="https://www.pixiv.net/",
            allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
        )
    except (urllib.error.URLError, TimeoutError) as exc:
        raise PixivResolveError(f"Pixiv user search failed for {keyword}: {exc}") from exc
    candidates = parse_user_search_html(raw_html, keyword, ssl_fallback_used)
    return [candidate for candidate in candidates if candidate.score >= min_score][:limit]


def resolve_name_by_fuzzy_search(
    artist_name: str,
    *,
    min_score: float = 0.35,
    cookie: str | None = None,
    allow_insecure_ssl_fallback: bool = True,
) -> PixivUserCandidate | None:
    candidates = search_pixiv_users(
        artist_name,
        limit=2,
        min_score=min_score,
        cookie=cookie,
        allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
    )
    if not candidates:
        return None
    if len(candidates) > 1 and candidates[0].score < 0.999 and candidates[0].score - candidates[1].score < 0.08:
        return None
    return candidates[0]


def fetch_user_work_ids(
    user_id: str,
    *,
    timeout: float = 15.0,
    cookie: str | None = None,
    allow_insecure_ssl_fallback: bool = True,
    max_pages: int | None = None,
) -> PixivUserWorks:
    url = PIXIV_USER_PROFILE_ALL_URL.format(user_id=user_id)
    try:
        raw_text, ssl_fallback_used = read_url_text_with_ssl_fallback(
            url,
            timeout=timeout,
            cookie=cookie,
            referer=f"https://www.pixiv.net/users/{user_id}/artworks",
            accept="application/json, text/plain, */*",
            allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
        )
    except (urllib.error.URLError, TimeoutError) as exc:
        raise PixivResolveError(f"Pixiv update check failed for artist {user_id}: {exc}") from exc

    try:
        raw = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise PixivResolveError(f"Pixiv update check failed for artist {user_id}: invalid JSON") from exc
    if raw.get("error"):
        message = str(raw.get("message") or "").strip() or "API returned error"
        raise PixivResolveError(f"Pixiv update check failed for artist {user_id}: {message}")

    work_ids = parse_user_work_ids_from_profile_all(raw, max_pages=max_pages)
    return PixivUserWorks(user_id=str(user_id), work_ids=work_ids, ssl_fallback_used=ssl_fallback_used)


def parse_user_name_from_profile_all(raw: dict, user_id: str) -> str:
    body = raw.get("body") or {}
    for key in ("userName", "name"):
        value = body.get(key)
        if value and str(value).strip() != str(user_id):
            return str(value)

    title = (((raw.get("extraData") or {}).get("meta") or {}).get("title") or "").strip()
    suffix = " - pixiv"
    if title.endswith(suffix):
        title = title[: -len(suffix)]
    return title if title and title != str(user_id) else ""


def parse_user_name_from_profile(raw: dict, user_id: str) -> str:
    body = raw.get("body") or {}
    nested_user = body.get("user") if isinstance(body.get("user"), dict) else {}
    for value in (
        body.get("name"),
        body.get("userName"),
        nested_user.get("name"),
        nested_user.get("userName"),
    ):
        if value and str(value).strip() != str(user_id):
            return str(value)
    return parse_user_name_from_profile_all(raw, user_id)


def fetch_user_profile(
    user_id: str,
    *,
    timeout: float = 15.0,
    cookie: str | None = None,
    allow_insecure_ssl_fallback: bool = True,
) -> PixivUserProfile:
    last_error: Exception | None = None
    for url, parser in (
        (PIXIV_USER_PROFILE_URL.format(user_id=user_id), parse_user_name_from_profile),
        (PIXIV_USER_PROFILE_ALL_URL.format(user_id=user_id), parse_user_name_from_profile_all),
    ):
        try:
            raw_text, ssl_fallback_used = read_url_text_with_ssl_fallback(
                url,
                timeout=timeout,
                cookie=cookie,
                referer=f"https://www.pixiv.net/users/{user_id}/artworks",
                accept="application/json, text/plain, */*",
                allow_insecure_ssl_fallback=allow_insecure_ssl_fallback,
            )
        except (urllib.error.URLError, TimeoutError) as exc:
            last_error = exc
            continue

        try:
            raw = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            last_error = exc
            continue
        if raw.get("error"):
            last_error = PixivResolveError(str(raw.get("message") or "").strip() or "API returned error")
            continue
        name = parser(raw, str(user_id)).strip()
        if name and name != str(user_id):
            return PixivUserProfile(id=str(user_id), name=name, ssl_fallback_used=ssl_fallback_used)

    detail = f": {last_error}" if last_error else ": no display name found"
    raise PixivResolveError(f"Pixiv profile request failed for artist {user_id}{detail}")
