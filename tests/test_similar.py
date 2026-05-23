import shutil
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from PIL import Image, ImageDraw

from pixiv_pbd_manager.similar import (
    fingerprint_image,
    find_similar_images,
    hamming_hex,
    iter_image_files,
    pixiv_page_key,
)


def make_pattern(path: Path, size=(128, 128), *, variant: str = "diagonal") -> None:
    image = Image.new("RGB", size, "white")
    draw = ImageDraw.Draw(image)
    if variant == "diagonal":
        for offset in range(-size[1], size[0], 12):
            draw.line((offset, size[1], offset + size[1], 0), fill="black", width=3)
        draw.rectangle((24, 32, 96, 88), outline="red", width=5)
    else:
        for x in range(0, size[0], 10):
            fill = "black" if (x // 10) % 2 else "white"
            draw.rectangle((x, 0, x + 5, size[1]), fill=fill)
        draw.ellipse((32, 24, 96, 104), outline="blue", width=5)
    image.save(path)


class SimilarImageTests(unittest.TestCase):
    def test_identical_file_sha256_matches(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = root / "first.png"
            second = root / "second.png"
            make_pattern(first)
            shutil.copyfile(first, second)

            self.assertEqual(fingerprint_image(first).sha256, fingerprint_image(second).sha256)

    def test_resized_image_groups_as_likely_similar(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = root / "first.png"
            second = root / "second.jpg"
            make_pattern(first, size=(160, 160))
            Image.open(first).resize((80, 80)).save(second, quality=92)

            result = find_similar_images([root], index_path=root / "index.json", threshold="likely")

            self.assertEqual(len(result.groups), 1)
            self.assertEqual(result.groups[0].kind, "likely")

    def test_different_images_are_not_highly_similar(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_pattern(root / "first.png", variant="diagonal")
            make_pattern(root / "second.png", variant="stripe")

            result = find_similar_images([root], index_path=root / "index.json", threshold="likely")

            self.assertEqual(result.groups, [])

    def test_gif_first_frame_is_indexed_and_corrupt_file_is_reported(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            gif = root / "animated.gif"
            Image.new("RGB", (32, 32), "red").save(gif, save_all=True, append_images=[Image.new("RGB", (32, 32), "blue")])
            (root / "broken.jpg").write_bytes(b"not an image")

            result = find_similar_images([root], index_path=root / "index.json")

            self.assertEqual(result.files_seen, 2)
            self.assertEqual(result.indexed, 1)
            self.assertEqual(result.error_count, 1)
            self.assertEqual(len(result.errors), 1)

    def test_corrupt_file_errors_are_capped(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            for index in range(5):
                (root / f"broken-{index}.jpg").write_bytes(b"not an image")

            result = find_similar_images([root], index_path=root / "index.json", max_errors=2)

            self.assertEqual(result.error_count, 5)
            self.assertEqual(len(result.errors), 2)

    def test_missing_pillow_fails_before_scanning_every_file(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "first.jpg").write_bytes(b"not an image")

            with patch("pixiv_pbd_manager.similar.fingerprint.Image", None):
                with self.assertRaisesRegex(RuntimeError, "Pillow is required"):
                    find_similar_images([root], index_path=root / "index.json")

    def test_incremental_scan_reuses_unchanged_fingerprints(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_pattern(root / "first.png")
            index = root / "index.json"
            first = find_similar_images([root], index_path=index)

            with patch("pixiv_pbd_manager.similar.fingerprint_image", side_effect=AssertionError("should reuse")):
                second = find_similar_images([root], index_path=index)

            self.assertEqual(first.indexed, 1)
            self.assertEqual(second.reused, 1)

    def test_pixiv_page_key_reads_pid_and_page(self):
        self.assertEqual(pixiv_page_key("12345678_p12.jpg"), ("12345678", 12))
        self.assertEqual(pixiv_page_key("title-12345678_p0-sample.png"), ("12345678", 0))
        self.assertIsNone(pixiv_page_key("12345678.jpg"))

    def test_can_skip_comparing_same_pixiv_work_pages(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = root / "12345678_p0.png"
            second = root / "12345678_p1.png"
            make_pattern(first)
            shutil.copyfile(first, second)

            skipped = find_similar_images(
                [root],
                index_path=root / "skip-index.json",
                skip_same_pixiv_work_pages=True,
            )
            included = find_similar_images(
                [root],
                index_path=root / "include-index.json",
                skip_same_pixiv_work_pages=False,
            )

            self.assertEqual(skipped.groups, [])
            self.assertEqual(len(included.groups), 1)

    def test_same_pixiv_page_can_still_group_with_duplicate(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = root / "12345678_p0.png"
            second = root / "copy-12345678_p0.png"
            make_pattern(first)
            shutil.copyfile(first, second)

            result = find_similar_images(
                [root],
                index_path=root / "index.json",
                skip_same_pixiv_work_pages=True,
            )

            self.assertEqual(len(result.groups), 1)

    def test_scan_emits_checkpoint_and_matching_progress(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_pattern(root / "first.png")
            make_pattern(root / "second.png")
            events: list[tuple[str, dict[str, object]]] = []

            result = find_similar_images(
                [root],
                index_path=root / "index.json",
                progress_callback=lambda key, payload: events.append((key, payload)),
                progress_interval=1,
                checkpoint_interval=1,
            )

            keys = [key for key, _payload in events]
            self.assertEqual(result.indexed, 2)
            self.assertIn("progress_similar_index_saved", keys)
            self.assertIn("progress_similar_match_start", keys)
            self.assertIn("progress_similar_match", keys)
            file_events = [payload for key, payload in events if key == "progress_similar_files"]
            self.assertTrue(any(payload.get("total_files") == 2 for payload in file_events))

    def test_small_scan_emits_file_start_progress_before_interval(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_pattern(root / "first.png")
            make_pattern(root / "second.png")
            events: list[tuple[str, dict[str, object]]] = []

            find_similar_images(
                [root],
                index_path=root / "index.json",
                progress_callback=lambda key, payload: events.append((key, payload)),
                progress_interval=100,
            )

            first_start = next(payload for key, payload in events if key == "progress_similar_file_start")
            self.assertEqual(first_start["files"], 1)
            self.assertEqual(first_start["total_files"], 2)

    def test_excluded_folder_is_skipped(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            excluded = root / "excluded"
            excluded.mkdir()
            make_pattern(root / "first.png")
            make_pattern(excluded / "second.png")

            paths = list(iter_image_files([root], [excluded]))

            self.assertEqual([path.name for path in paths], ["first.png"])

    def test_hamming_hex(self):
        self.assertEqual(hamming_hex("0f", "00"), 4)


if __name__ == "__main__":
    unittest.main()
