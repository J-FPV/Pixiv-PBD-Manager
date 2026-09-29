"""Review queue contracts use isolated datasets and mocked Pixiv requests."""

from pathlib import Path
from unittest.mock import patch

import pytest

from pixiv_pbd_manager.gui_api import run_command
from pixiv_pbd_manager.gui_api.runtime import CONTROL
from pixiv_pbd_manager.resolver import PixivResolveError, ResolvedArtist


@pytest.fixture
def dataset(tmp_path):
    (tmp_path / ".pixiv-pbd-manager").mkdir()
    library = tmp_path / "library"
    library.mkdir()
    return {"project_root": str(tmp_path), "database": str(tmp_path / "artists.json"),
            "roots": [str(library)], "download_roots": [str(library)], "resolve_online": False, "resolve_delay": 0}


def call(payload, command, **extra):
    CONTROL.reset()
    events = []
    code = run_command(command, {**payload, **extra}, emit=events.append)
    if code:
        raise ValueError(events[-1]["message"])
    return events[-1]["payload"]


def image(dataset, relative):
    path = Path(dataset["roots"][0]) / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"image")
    return str(path.parent)


def test_persist_partial_and_stale_guard(dataset):
    first = image(dataset, "A-55555/10000001_p0.jpg")
    second = image(dataset, "B-66666/10000002_p0.jpg")
    call(dataset, "scan.preview")
    rows = call(dataset, "scan.review.list")["items"]
    assert len(rows) == 2
    assert all(row["status"] == "awaiting_confirmation" for row in rows)
    item = call(dataset, "scan.review.detail", path=first)
    call(dataset, "scan.review.apply", path=first, revision=item["revision"])
    assert [row["path"] for row in call(dataset, "scan.review.list")["items"]] == [second]
    assert call(dataset, "scan.review.detail", path=second)["stale"]
    call(dataset, "scan.review.retry", path=second)
    item = call(dataset, "scan.review.detail", path=second)
    image(dataset, "B-66666/10000003_p0.jpg")
    with pytest.raises(ValueError, match="stale"):
        call(dataset, "scan.review.apply", path=second, revision=item["revision"])
    assert len(call(dataset, "scan.review.list")["items"]) == 1


def test_migration_has_no_invented_evidence(dataset):
    folder = image(dataset, "legacy/photo.jpg")
    result = call(dataset, "scan.review.list", legacy_folders=[{"path": folder, "count": 1}])["items"][0]
    assert result["status"] == "pending" and result["stale"]
    assert result["candidates"] == [] and result["queries"] == []
    with pytest.raises(ValueError):
        call(dataset, "scan.review.apply", path=folder, revision=result["revision"])


def test_query_evidence_conflict_and_limit(dataset):
    for number in range(40):
        folder = image(dataset, f"mixed/{10000000 + number}_p0.jpg")
    image(dataset, "unrelated/99999999_p0.jpg")
    call(dataset, "scan.preview")
    queried = []

    def fetch(pid, **kwargs):
        queried.append(pid)
        return ResolvedArtist("11111" if int(pid) % 2 else "22222", "Artist", pid)

    with patch("pixiv_pbd_manager.resolver.fetch_artwork_author", side_effect=fetch), patch("time.sleep"):
        for _ in range(9):
            call(dataset, "scan.review.sample", path=folder, resolve_online=True)
    assert len(queried) == len(set(queried)) == 30
    assert "99999999" not in queried
    item = call(dataset, "scan.review.detail", path=folder)
    assert item["status"] == "conflict"
    assert len(item["queries"]) == 30
    with pytest.raises(ValueError, match="single"):
        call(dataset, "scan.review.apply", path=folder, revision=item["revision"])
    original_ids = {query["pid"] for query in item["queries"]}
    image(dataset, "mixed/19999999_p0.jpg")
    with patch("pixiv_pbd_manager.resolver.fetch_artwork_author", side_effect=fetch), patch("time.sleep"):
        call(dataset, "scan.preview", resolve_online=True)
    again = call(dataset, "scan.review.detail", path=folder)
    assert {query["pid"] for query in again["queries"]} == original_ids


def test_cancelled_rescan_retains_unprocessed_suggestions(dataset):
    folder = image(dataset, "Artist-55555/10000000_p0.jpg")
    call(dataset, "scan.preview")
    before = call(dataset, "scan.review.detail", path=folder)
    with patch("pixiv_pbd_manager.gui_api.runtime.CONTROL.is_cancelled", return_value=True):
        result = call(dataset, "scan.preview")
    assert result["cancelled"]
    after = call(dataset, "scan.review.detail", path=folder)
    assert after["candidates"] == before["candidates"] and after["revision"] == before["revision"]


def test_retry_only_failed_and_cancel_persists(dataset):
    folder = image(dataset, "plain/10000000_p0.jpg")
    image(dataset, "plain/10000001_p0.jpg")
    with patch("pixiv_pbd_manager.resolver.fetch_artwork_author", side_effect=[PixivResolveError("HTTP 429"), ResolvedArtist("11111", "A", "10000000")]):
        call(dataset, "scan.preview", resolve_online=True)
    item = call(dataset, "scan.review.detail", path=folder)
    assert {query["status"] for query in item["queries"]} == {"failed", "resolved"}
    failed = [query["pid"] for query in item["queries"] if query["status"] == "failed"]
    with patch("pixiv_pbd_manager.resolver.fetch_artwork_author", return_value=ResolvedArtist("11111", "A", failed[0])) as fetch, patch("time.sleep"):
        call(dataset, "scan.review.retry", path=folder, resolve_online=True)
    assert fetch.call_count == 1
    assert fetch.call_args.args[0] == failed[0]
    assert call(dataset, "scan.review.detail", path=folder)["status"] == "awaiting_confirmation"


def test_offline_and_no_clues(dataset):
    folder = image(dataset, "plain/photo.jpg")
    call(dataset, "scan.preview")
    assert call(dataset, "scan.review.detail", path=folder)["status"] == "no_clues"
    assert call(dataset, "scan.review.detail", path=folder)["sample_paths"] == [str(Path(folder) / "photo.jpg")]
    Path(folder).rename(Path(folder).with_name("moved"))
    assert call(dataset, "scan.review.detail", path=folder)["unavailable"]
