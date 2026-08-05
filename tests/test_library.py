from __future__ import annotations

import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image

from pixiv_pbd_manager.database import ArtistDatabase
from pixiv_pbd_manager.library import (
    FAILURE_RETRY_INTERVAL,
    FAILURE_RETRY_LIMIT,
    LibraryImage,
    TagCacheEntry,
    apply_tag_cache,
    build_catalog,
    build_pid_to_artist,
    build_save_path_index,
    library_index_status,
    load_library_index,
    load_tag_cache,
    merge_tag_cache,
    needs_fetch,
    parse_pixiv_name,
    read_image_size,
    save_library_index,
    save_library_index_metadata,
    save_tag_cache,
    seed_tag_cache_from_images,
)


def _by_name(images: list[LibraryImage]) -> dict[str, LibraryImage]:
    return {Path(image.path).name: image for image in images}


class CatalogParsingTests(unittest.TestCase):
    def test_parse_pixiv_name_prefers_page_form(self):
        self.assertEqual(parse_pixiv_name(Path("100949474_p3.jpg")), ("100949474", 3))

    def test_parse_pixiv_name_falls_back_to_work_id(self):
        self.assertEqual(parse_pixiv_name(Path("100949474.png")), ("100949474", None))

    def test_parse_pixiv_name_returns_empty_when_no_id(self):
        self.assertEqual(parse_pixiv_name(Path("sketch.png")), ("", None))

    def test_parse_pixiv_name_ignores_timestamps(self):
        for name in (
            "20230912_165005.jpg",
            "20230912-165005.jpg",
            "2023-09-12.png",
            "IMG_20230912_165005.jpg",
            "Screenshot_2023-09-12-16-50-05.png",
        ):
            self.assertEqual(parse_pixiv_name(Path(name)), ("", None), name)

    def test_parse_pixiv_name_keeps_real_ids(self):
        # A date inside a title must not suppress a genuine leading work id.
        self.assertEqual(parse_pixiv_name(Path("12345678-2023 spring.jpg")), ("12345678", None))
        self.assertEqual(parse_pixiv_name(Path("100949474_p0.jpg")), ("100949474", 0))

    def test_parse_pixiv_name_prefers_export_pid_over_date_metadata(self):
        self.assertEqual(
            parse_pixiv_name(Path("illust_103493847_20221224_205536.jpg")),
            ("103493847", None),
        )
        self.assertEqual(parse_pixiv_name(Path("album_20240501_final.png")), ("", None))


class CatalogBuildTests(unittest.TestCase):
    def test_build_extracts_metadata_and_orientation(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            Image.new("RGB", (40, 20), "red").save(root / "100949474_p0.jpg")  # landscape
            Image.new("RGB", (20, 40), "blue").save(root / "200000001_p1.png")  # portrait
            images, summary = build_catalog([root], [], pid_to_artist={"100949474": "555"})

        self.assertEqual(summary.indexed, 2)
        self.assertEqual(summary.changed, 2)
        self.assertEqual(summary.reused, 0)
        rows = _by_name(images)
        wide = rows["100949474_p0.jpg"]
        self.assertEqual((wide.width, wide.height), (40, 20))
        self.assertEqual(wide.orientation, "landscape")
        self.assertEqual(wide.format, "jpg")
        self.assertEqual(wide.pid, "100949474")
        self.assertEqual(wide.page, 0)
        self.assertEqual(wide.artist_id, "555")
        tall = rows["200000001_p1.png"]
        self.assertEqual(tall.orientation, "portrait")
        self.assertEqual(tall.artist_id, "")  # no mapping for this pid

    def test_rebuild_reuses_dims_and_carries_user_metadata(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            image_path = root / "100949474_p0.png"
            Image.new("RGB", (30, 30), "green").save(image_path)
            first, _ = build_catalog([root], [], pid_to_artist={})
            first[0].tags = ["fanart", "wallpaper"]
            first[0].favorite = True
            first[0].rating = 4
            first[0].markers = ["high_value", "to_sort"]
            old = {img.path: img for img in first}
            images, summary = build_catalog([root], [], pid_to_artist={}, old_catalog=old)

        self.assertEqual(summary.reused, 1)
        self.assertEqual(summary.changed, 0)
        self.assertEqual(images[0].tags, ["fanart", "wallpaper"])
        self.assertTrue(images[0].favorite)
        self.assertEqual(images[0].rating, 4)
        self.assertEqual(images[0].markers, ["high_value", "to_sort"])

    def test_build_prefers_unique_save_path_artist(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            artist_dir = root / "artist"
            artist_dir.mkdir()
            Image.new("RGB", (30, 30), "green").save(artist_dir / "100949474_p0.png")
            images, _ = build_catalog(
                [root],
                [],
                pid_to_artist={"100949474": "wrong"},
                save_path_index={os.path.normcase(str(artist_dir.resolve())): "right"},
            )

        self.assertEqual(images[0].artist_id, "right")

    def test_round_trip_through_index_file(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            Image.new("RGB", (10, 10), "red").save(root / "100949474_p0.png")
            images, _ = build_catalog([root], [], pid_to_artist={})
            images[0].tags = ["keep"]
            images[0].favorite = True
            images[0].rating = 5
            images[0].markers = ["used"]
            index_path = root / "library_index.json"
            save_library_index(images, index_path)
            loaded = load_library_index(index_path)

        self.assertEqual(set(loaded), {images[0].path})
        self.assertEqual(loaded[images[0].path].tags, ["keep"])
        self.assertTrue(loaded[images[0].path].favorite)
        self.assertEqual(loaded[images[0].path].rating, 5)
        self.assertEqual(loaded[images[0].path].markers, ["used"])
        self.assertEqual(loaded[images[0].path].pid, "100949474")

    def test_index_status_tracks_age_and_root_changes(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            index_path = root / "library_index.json"
            save_library_index([], index_path)
            save_library_index_metadata(index_path, [root], [], entry_count=12, timestamp=1_000)

            fresh = library_index_status(index_path, [root], [], now=1_100)
            stale = library_index_status(index_path, [root], [], now=30_000)
            changed = library_index_status(index_path, [root], [root / "excluded"], now=1_100)

        self.assertFalse(fresh["stale"])
        self.assertEqual(fresh["entry_count"], 12)
        self.assertTrue(stale["stale"])
        self.assertIn("age", stale["reasons"])
        self.assertTrue(changed["stale"])
        self.assertIn("excludes_changed", changed["reasons"])

    def test_legacy_index_without_metadata_is_stale(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            index_path = root / "library_index.json"
            save_library_index([], index_path)
            status = library_index_status(index_path, [root], [])

        self.assertTrue(status["stale"])
        self.assertIn("metadata_missing", status["reasons"])


class PidToArtistTests(unittest.TestCase):
    def test_maps_each_work_id_to_its_artist(self):
        with TemporaryDirectory() as tmp:
            db = ArtistDatabase(Path(tmp) / "artists.json")
            db.upsert("111", name="A", source="manual")
            db.artists["111"].work_ids = ["1001", "1002"]
            db.upsert("222", name="B", source="manual")
            db.artists["222"].work_ids = ["2001"]
            mapping = build_pid_to_artist(db)

        self.assertEqual(mapping, {"1001": "111", "1002": "111", "2001": "222"})

    def test_omits_conflicting_work_ids_and_save_paths(self):
        with TemporaryDirectory() as tmp:
            shared = Path(tmp) / "shared"
            db = ArtistDatabase(Path(tmp) / "artists.json")
            db.upsert("111", name="A", source="manual", save_path=shared)
            db.artists["111"].work_ids = ["1001"]
            db.upsert("222", name="B", source="manual", save_path=shared)
            db.artists["222"].work_ids = ["1001"]

            self.assertNotIn("1001", build_pid_to_artist(db))
            self.assertNotIn(os.path.normcase(str(shared.resolve())), build_save_path_index(db))


class ReadImageSizeTests(unittest.TestCase):
    def test_reads_header_dimensions(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "sample.png"
            Image.new("RGB", (64, 48), "red").save(path)
            self.assertEqual(read_image_size(path), (64, 48))


def _image(path: str, pid: str, pixiv_tags: list[dict[str, str]] | None = None) -> LibraryImage:
    return LibraryImage(
        path=path,
        size_bytes=10,
        mtime_ns=1,
        width=4,
        height=4,
        format="jpg",
        pid=pid,
        pixiv_tags=list(pixiv_tags or []),
    )


TAGS = [{"tag": "水色髪", "translation": "light blue hair"}]


class TagCacheTests(unittest.TestCase):
    def test_round_trip_through_cache_file(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "pixiv_tags.json"
            entry = TagCacheEntry(
                pid="12345678", tags=TAGS, fetched_at=1700.5, ok=True, source="fetch", attempts=2
            )
            save_tag_cache({entry.pid: entry}, path)
            loaded = load_tag_cache(path)

        self.assertEqual(list(loaded), ["12345678"])
        restored = loaded["12345678"]
        self.assertEqual(restored.tags, TAGS)
        self.assertEqual(restored.fetched_at, 1700.5)
        self.assertTrue(restored.ok)
        self.assertEqual(restored.source, "fetch")
        self.assertEqual(restored.attempts, 2)

    def test_load_returns_empty_for_missing_and_corrupt_files(self):
        with TemporaryDirectory() as tmp:
            missing = Path(tmp) / "nope.json"
            self.assertEqual(load_tag_cache(missing), {})
            corrupt = Path(tmp) / "corrupt.json"
            corrupt.write_text("{not json", encoding="utf-8")
            self.assertEqual(load_tag_cache(corrupt), {})

    def test_seed_adopts_catalog_tags_for_unknown_pid(self):
        cache: dict[str, TagCacheEntry] = {}
        seeded = seed_tag_cache_from_images(cache, [_image("a.jpg", "12345678", TAGS)], now=99.0)
        self.assertEqual(seeded, 1)
        entry = cache["12345678"]
        self.assertEqual(entry.tags, TAGS)
        self.assertTrue(entry.ok)
        self.assertEqual(entry.source, "catalog")
        self.assertEqual(entry.fetched_at, 99.0)

    def test_seed_skips_pid_with_empty_catalog_tags(self):
        # Empty catalog tags are ambiguous between "never fetched" and "this
        # artwork has no tags", so they must stay fetchable rather than be
        # adopted as a successful result.
        cache: dict[str, TagCacheEntry] = {}
        self.assertEqual(seed_tag_cache_from_images(cache, [_image("a.jpg", "12345678")]), 0)
        self.assertNotIn("12345678", cache)
        self.assertTrue(needs_fetch(cache.get("12345678")))

    def test_seed_does_not_overwrite_existing_entry(self):
        cache = {"12345678": TagCacheEntry(pid="12345678", ok=False, error="boom", fetched_at=5.0)}
        self.assertEqual(seed_tag_cache_from_images(cache, [_image("a.jpg", "12345678", TAGS)]), 0)
        self.assertFalse(cache["12345678"].ok)
        self.assertTrue(needs_fetch(cache["12345678"]))

    def test_seed_is_order_independent_across_pages(self):
        images = [_image("a_p0.jpg", "12345678"), _image("a_p1.jpg", "12345678", TAGS)]
        cache: dict[str, TagCacheEntry] = {}
        self.assertEqual(seed_tag_cache_from_images(cache, images), 1)
        self.assertEqual(cache["12345678"].tags, TAGS)

    def test_apply_hydrates_moved_file_by_pid(self):
        # The regression this whole cache exists for: the path changed, so the
        # catalog's path-keyed carry-forward dropped the tags.
        moved = _image("D:/new/place/12345678_p0.jpg", "12345678")
        cache = {"12345678": TagCacheEntry(pid="12345678", tags=TAGS, ok=True)}
        self.assertEqual(apply_tag_cache([moved], cache), {"12345678"})
        self.assertEqual(moved.pixiv_tags, TAGS)

    def test_apply_reports_no_change_when_already_current(self):
        image = _image("a.jpg", "12345678", TAGS)
        cache = {"12345678": TagCacheEntry(pid="12345678", tags=TAGS, ok=True)}
        self.assertEqual(apply_tag_cache([image], cache), set())

    def test_apply_ignores_failed_entries(self):
        image = _image("a.jpg", "12345678", TAGS)
        cache = {"12345678": TagCacheEntry(pid="12345678", tags=[], ok=False, error="404")}
        self.assertEqual(apply_tag_cache([image], cache), set())
        self.assertEqual(image.pixiv_tags, TAGS)

    def test_apply_writes_empty_tags_for_a_tagless_artwork(self):
        image = _image("a.jpg", "12345678", TAGS)
        cache = {"12345678": TagCacheEntry(pid="12345678", tags=[], ok=True)}
        self.assertEqual(apply_tag_cache([image], cache), {"12345678"})
        self.assertEqual(image.pixiv_tags, [])

    def test_apply_ignores_images_without_pid(self):
        image = _image("a.jpg", "")
        self.assertEqual(apply_tag_cache([image], {"": TagCacheEntry(pid="", tags=TAGS)}), set())

    def test_needs_fetch_rules(self):
        ok = TagCacheEntry(pid="1", ok=True)
        failed = TagCacheEntry(pid="1", ok=False)
        self.assertTrue(needs_fetch(None))
        self.assertFalse(needs_fetch(ok))
        self.assertTrue(needs_fetch(failed))
        for entry in (None, ok, failed):
            self.assertTrue(needs_fetch(entry, force=True))

    def test_needs_fetch_retries_a_failure_up_to_the_limit(self):
        for attempts in range(FAILURE_RETRY_LIMIT):
            entry = TagCacheEntry(pid="1", ok=False, attempts=attempts, fetched_at=100.0)
            self.assertTrue(needs_fetch(entry, now=100.0), f"attempts={attempts}")

    def test_needs_fetch_defers_after_repeated_failures(self):
        # A deleted or restricted work fails identically forever; retrying it on
        # every run is what this back-off exists to stop.
        entry = TagCacheEntry(pid="1", ok=False, attempts=FAILURE_RETRY_LIMIT, fetched_at=100.0)
        self.assertFalse(needs_fetch(entry, now=100.0 + FAILURE_RETRY_INTERVAL - 1))

    def test_needs_fetch_retries_once_the_interval_elapses(self):
        entry = TagCacheEntry(pid="1", ok=False, attempts=FAILURE_RETRY_LIMIT, fetched_at=100.0)
        self.assertTrue(needs_fetch(entry, now=100.0 + FAILURE_RETRY_INTERVAL))

    def test_force_overrides_the_back_off(self):
        # The "re-fetch tags" button must always be able to reach a dead work.
        entry = TagCacheEntry(pid="1", ok=False, attempts=99, fetched_at=100.0)
        self.assertTrue(needs_fetch(entry, force=True, now=100.0))

    def test_back_off_never_applies_to_a_success(self):
        entry = TagCacheEntry(pid="1", ok=True, attempts=99, fetched_at=0.0)
        self.assertFalse(needs_fetch(entry, now=1e12))

    def test_merge_prefers_newer_fetched_at(self):
        base = {
            "1": TagCacheEntry(pid="1", tags=[], fetched_at=10.0),
            "2": TagCacheEntry(pid="2", tags=TAGS, fetched_at=50.0),
        }
        incoming = {
            "1": TagCacheEntry(pid="1", tags=TAGS, fetched_at=20.0),
            "2": TagCacheEntry(pid="2", tags=[], fetched_at=5.0),
            "3": TagCacheEntry(pid="3", tags=TAGS, fetched_at=1.0),
        }
        merged = merge_tag_cache(base, incoming)
        self.assertEqual(merged["1"].tags, TAGS)  # incoming is newer
        self.assertEqual(merged["2"].tags, TAGS)  # base is newer, kept
        self.assertIn("3", merged)  # new pid adopted


if __name__ == "__main__":
    unittest.main()
