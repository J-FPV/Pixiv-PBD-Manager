import ssl
import unittest
import urllib.error
from unittest.mock import patch

from pixiv_pbd_manager.resolver import (
    PIXIV_PROFILE_WORKS_PER_PAGE,
    PixivResolveError,
    ResolvedArtist,
    candidate_score,
    fetch_artwork_author,
    fetch_user_profile,
    parse_user_name_from_profile_all,
    parse_user_work_ids_from_profile_all,
    parse_user_search_html,
    resolve_name_only_artist,
)
from pixiv_pbd_manager.scanner import NameOnlyArtistHit
from pathlib import Path


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return b'{"error": false, "body": {"userId": "126324", "userName": "96YOTTEA"}}'


class ResolverTests(unittest.TestCase):
    def test_retries_with_ssl_fallback_on_certificate_error(self):
        cert_error = urllib.error.URLError(ssl.SSLCertVerificationError("CERTIFICATE_VERIFY_FAILED"))
        with patch("urllib.request.urlopen", side_effect=[cert_error, FakeResponse()]) as urlopen:
            resolved = fetch_artwork_author("100187254")

        self.assertIsNotNone(resolved)
        assert resolved is not None
        self.assertEqual(resolved.id, "126324")
        self.assertTrue(resolved.ssl_fallback_used)
        self.assertIsNotNone(urlopen.call_args_list[1].kwargs["context"])

    def test_can_disable_ssl_fallback(self):
        cert_error = urllib.error.URLError(ssl.SSLCertVerificationError("CERTIFICATE_VERIFY_FAILED"))
        with patch("urllib.request.urlopen", side_effect=cert_error):
            with self.assertRaises(PixivResolveError):
                fetch_artwork_author("100187254", allow_insecure_ssl_fallback=False)

    def test_parse_user_search_html_candidates(self):
        raw_html = '<script type="application/json">{"props":{"userId":"123456","userName":"一条レイ"}}</script>'

        candidates = parse_user_search_html(raw_html, "一条レイ", False)

        self.assertEqual(candidates[0].id, "123456")
        self.assertEqual(candidates[0].name, "一条レイ")
        self.assertGreater(candidates[0].score, 0.9)

    def test_candidate_score_handles_full_width_and_display_suffix(self):
        self.assertEqual(candidate_score("Ａｎｍｉ", "Anmi@画集発売中"), 1.0)

    def test_name_only_resolution_requires_consistent_pid_authors(self):
        hit = NameOnlyArtistHit(
            artist_key="name:test",
            artist_name="Artist",
            source="test",
            root=Path("."),
            folder=Path("."),
            path=Path("100.jpg"),
            work_ids={"100", "101", "102"},
        )
        results = [
            ResolvedArtist(id="1", name="A", work_id="102"),
            ResolvedArtist(id="1", name="A", work_id="101"),
            ResolvedArtist(id="2", name="B", work_id="100"),
        ]
        with patch("pixiv_pbd_manager.resolver.fetch_artwork_author", side_effect=results):
            resolved = resolve_name_only_artist(hit, max_work_ids=3, delay_seconds=0)

        self.assertIsNotNone(resolved)
        assert resolved is not None
        self.assertEqual(resolved.id, "1")

    def test_name_only_resolution_skips_bad_pid_and_keeps_trying(self):
        hit = NameOnlyArtistHit(
            artist_key="name:test",
            artist_name="Artist",
            source="test",
            root=Path("."),
            folder=Path("."),
            path=Path("100.jpg"),
            work_ids={"100", "101"},
        )
        results = [
            PixivResolveError("temporary failure"),
            ResolvedArtist(id="1", name="A", work_id="100"),
        ]
        with patch("pixiv_pbd_manager.resolver.fetch_artwork_author", side_effect=results):
            resolved = resolve_name_only_artist(hit, max_work_ids=2, delay_seconds=0)

        self.assertIsNotNone(resolved)
        assert resolved is not None
        self.assertEqual(resolved.id, "1")

    def test_name_only_resolution_rejects_split_vote(self):
        hit = NameOnlyArtistHit(
            artist_key="name:test",
            artist_name="Artist",
            source="test",
            root=Path("."),
            folder=Path("."),
            path=Path("100.jpg"),
            work_ids={"100", "101"},
        )
        results = [
            ResolvedArtist(id="1", name="A", work_id="101"),
            ResolvedArtist(id="2", name="B", work_id="100"),
        ]
        with patch("pixiv_pbd_manager.resolver.fetch_artwork_author", side_effect=results):
            resolved = resolve_name_only_artist(hit, max_work_ids=2, delay_seconds=0)

        self.assertIsNone(resolved)

    def test_parse_user_name_from_profile_all_meta_title(self):
        raw = {"body": {"illusts": {}}, "extraData": {"meta": {"title": "Artist Name - pixiv"}}}

        self.assertEqual(parse_user_name_from_profile_all(raw, "123456"), "Artist Name")

    def test_parse_user_name_from_profile_all_rejects_numeric_fallback(self):
        raw = {"body": {"illusts": {}}, "extraData": {"meta": {"title": "123456 - pixiv"}}}

        self.assertEqual(parse_user_name_from_profile_all(raw, "123456"), "")

    def test_parse_user_work_ids_can_limit_to_newest_profile_pages(self):
        raw = {
            "body": {
                "illusts": {str(work_id): {} for work_id in range(100, 160)},
                "manga": {"220": {}, "221": {}},
            }
        }

        work_ids = parse_user_work_ids_from_profile_all(raw, max_pages=1)

        self.assertEqual(len(work_ids), PIXIV_PROFILE_WORKS_PER_PAGE)
        self.assertIn("221", work_ids)
        self.assertIn("159", work_ids)
        self.assertNotIn("100", work_ids)

    def test_fetch_user_profile_prefers_user_profile_endpoint_name(self):
        calls = []

        def fake_read(url, **_kwargs):
            calls.append(url)
            return ('{"error": false, "body": {"name": "Correct Artist"}}', False)

        with patch("pixiv_pbd_manager.resolver.read_url_text_with_ssl_fallback", side_effect=fake_read):
            profile = fetch_user_profile("123456")

        self.assertEqual(profile.name, "Correct Artist")
        self.assertEqual(len(calls), 1)

    def test_fetch_user_profile_falls_back_when_profile_endpoint_has_no_name(self):
        responses = [
            ('{"error": false, "body": {"id": "123456"}}', False),
            ('{"error": false, "body": {}, "extraData": {"meta": {"title": "Fallback Artist - pixiv"}}}', False),
        ]

        with patch("pixiv_pbd_manager.resolver.read_url_text_with_ssl_fallback", side_effect=responses):
            profile = fetch_user_profile("123456")

        self.assertEqual(profile.name, "Fallback Artist")


if __name__ == "__main__":
    unittest.main()
