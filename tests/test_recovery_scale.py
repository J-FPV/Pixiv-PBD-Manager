from time import perf_counter

from pixiv_pbd_manager.library.annotations import annotated_catalog
from pixiv_pbd_manager.library.catalog import LibraryImage, save_library_index
from pixiv_pbd_manager.recovery.archive import create_archive, inspect_archive
from pixiv_pbd_manager.recovery.session import RecoverySession


def test_thirty_thousand_rows_backup_and_preview(tmp_path):
    directory = tmp_path / ".pixiv-pbd-manager"
    directory.mkdir()
    index = directory / "library_index.json"
    images = [LibraryImage(path=str(tmp_path / f"{number}.png"), size_bytes=1000, mtime_ns=123456789,
                           width=100, height=200, format="png", rating=5 if number % 30 == 0 else 0) for number in range(30_000)]
    save_library_index(images, index)
    with annotated_catalog(index):
        pass
    with RecoverySession({"_base_dir": str(tmp_path)}, "backup.create", lambda _: None) as session:
        start = perf_counter()
        with session.guard(), session.suspended():
            identity = create_archive(session, "manual", "manual")
        elapsed = perf_counter() - start
        start = perf_counter()
        _, data = inspect_archive(directory / "backups" / f"{identity}.zip")
        parsed = perf_counter() - start
        assert len(data["annotations"]["records"]) == 30_000
        print(f"30,000 rows: backup {elapsed:.2f}s, validate {parsed:.2f}s")
        assert elapsed < 20 and parsed < 10
