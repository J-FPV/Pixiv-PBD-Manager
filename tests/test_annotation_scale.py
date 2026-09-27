from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter
import unittest

from pixiv_pbd_manager.library.annotations import annotated_catalog
from pixiv_pbd_manager.library.catalog import LibraryImage, save_library_index


class AnnotationScaleTests(unittest.TestCase):
    def test_thirty_thousand_catalog_entries_migrate_and_overlay(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            index = root / "library_index.json"
            images = [LibraryImage(path=str(root / f"{number}.png"), size_bytes=12345, mtime_ns=123456789,
                                   width=200, height=300, format="png", tags=["reference"] if number % 30 == 0 else [])
                      for number in range(30_000)]
            save_library_index(images, index)
            start = perf_counter()
            with annotated_catalog(index) as (store, catalog):
                self.assertEqual(len(catalog), 30_000)
                self.assertEqual(store.status()["pending"], 1_000)
                self.assertEqual(len({image.image_id for image in catalog.values()}), 30_000)
                save_library_index(catalog.values(), index, annotation_store_id=store.store_id)
            migrated = perf_counter() - start
            start = perf_counter()
            with annotated_catalog(index) as (_store, catalog):
                self.assertEqual(sum(bool(image.tags) for image in catalog.values()), 1_000)
            elapsed = perf_counter() - start
            print(f"30,000 annotations: migrate {migrated:.2f}s, load/overlay {elapsed:.2f}s")
            self.assertLess(migrated, 30)
            self.assertLess(elapsed, 10)
