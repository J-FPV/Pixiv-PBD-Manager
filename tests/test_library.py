from __future__ import annotations

import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image

from pixiv_pbd_manager.database import ArtistDatabase
from pixiv_pbd_manager.library import (
    LibraryImage,
    build_catalog,
    build_pid_to_artist,
    build_save_path_index,
    load_library_index,
    parse_pixiv_name,
    read_image_size,
    save_library_index,
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

    def test_rebuild_reuses_dims_and_carries_tags(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            image_path = root / "100949474_p0.png"
            Image.new("RGB", (30, 30), "green").save(image_path)
            first, _ = build_catalog([root], [], pid_to_artist={})
            first[0].tags = ["fanart", "wallpaper"]
            old = {img.path: img for img in first}
            images, summary = build_catalog([root], [], pid_to_artist={}, old_catalog=old)

        self.assertEqual(summary.reused, 1)
        self.assertEqual(summary.changed, 0)
        self.assertEqual(images[0].tags, ["fanart", "wallpaper"])

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
            index_path = root / "library_index.json"
            save_library_index(images, index_path)
            loaded = load_library_index(index_path)

        self.assertEqual(set(loaded), {images[0].path})
        self.assertEqual(loaded[images[0].path].tags, ["keep"])
        self.assertEqual(loaded[images[0].path].pid, "100949474")


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


if __name__ == "__main__":
    unittest.main()
