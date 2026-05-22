from __future__ import annotations

import argparse
import csv
import sys
import time
from pathlib import Path

from .browser import open_urls
from .consent import is_cookie_consent_recorded, record_cookie_consent
from .database import DEFAULT_DB, ArtistDatabase
from .i18n import text
from .models import utc_now
from .operations import check_artist_updates, download_artist_updates, scan_into_database
from .similar import find_similar_images, write_similar_report


def positive_float(value: str) -> float:
    parsed = float(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError("must be >= 0")
    return parsed


def nonnegative_int(value: str) -> int:
    parsed = int(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError("must be >= 0")
    return parsed


def add_db_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--db", default=str(DEFAULT_DB), help="artist database path")


def add_cookie_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--pixiv-cookie", help="optional Pixiv cookie string for restricted artworks")
    parser.add_argument(
        "--accept-cookie-risk",
        action="store_true",
        help="accept the Pixiv cookie risk disclaimer; required when using --pixiv-cookie for the first time",
    )


def ensure_cookie_consent(args: argparse.Namespace) -> bool:
    if not getattr(args, "pixiv_cookie", None):
        return True
    if is_cookie_consent_recorded():
        return True
    if getattr(args, "accept_cookie_risk", False):
        record_cookie_consent()
        return True
    print(text("en", "consent_required_cli"), file=sys.stderr)
    return False


def cmd_scan(args: argparse.Namespace) -> int:
    if not ensure_cookie_consent(args):
        return 2
    roots = [Path(root) for root in args.roots]
    missing = [str(root) for root in roots if not root.exists()]
    if missing:
        print(f"Missing path(s): {', '.join(missing)}", file=sys.stderr)
        return 2

    result = scan_into_database(
        roots,
        Path(args.db),
        resolve_online=args.resolve_online,
        resolve_limit=args.resolve_limit,
        resolve_delay=args.resolve_delay,
        pixiv_cookie=args.pixiv_cookie,
        allow_insecure_ssl_fallback=not args.no_ssl_fallback,
        exclude_roots=[Path(path) for path in args.exclude],
        fuzzy_search_names=args.fuzzy_search,
        fuzzy_min_score=args.fuzzy_min_score,
    )
    summary = result.summary

    print(f"Scanned files: {summary.files_seen}")
    print(f"Excluded folders: {summary.excluded_dirs}")
    print(f"Matched files with artist id: {summary.files_matched}")
    print(f"Artists found with id: {len(summary.artists)}")
    print(f"Pixiv name-only folders: {len(summary.name_only_artists)}")
    if args.resolve_online:
        print(f"Online resolved name-only folders: {result.resolved_name_only}")
        if args.fuzzy_search:
            print(f"Fuzzy-search resolved folders: {result.fuzzy_resolved_name_only}")
        if result.ssl_fallback_used:
            print(f"SSL certificate fallback used: {result.ssl_fallback_used}")
    else:
        print("Use --resolve-online to resolve Pixiv folders that only contain artist names.")
    print(f"Database changed artists: {result.changed}")
    print(f"Database: {result.db_path}")
    for error in result.resolve_errors:
        print(f"Resolve error: {error}", file=sys.stderr)
    if args.show_unmatched and summary.unmatched_examples:
        print("Unmatched examples:")
        for path in summary.unmatched_examples:
            print(f"  {path}")
    return 0


def cmd_watch(args: argparse.Namespace) -> int:
    if not ensure_cookie_consent(args):
        return 2
    print("Watching download folder. Press Ctrl+C to stop.")
    try:
        while True:
            scan_args = argparse.Namespace(
                roots=args.roots,
                db=args.db,
                show_unmatched=False,
                resolve_online=args.resolve_online,
                resolve_limit=args.resolve_limit,
                resolve_delay=args.resolve_delay,
                pixiv_cookie=args.pixiv_cookie,
                no_ssl_fallback=args.no_ssl_fallback,
                exclude=args.exclude,
                fuzzy_search=args.fuzzy_search,
                fuzzy_min_score=args.fuzzy_min_score,
            )
            cmd_scan(scan_args)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("Stopped.")
        return 0


def cmd_add(args: argparse.Namespace) -> int:
    db = ArtistDatabase.load(args.db)
    changed = db.upsert(args.artist_id, name=args.name, source="manual")
    db.save()
    status = "updated" if changed else "already present"
    print(f"{args.artist_id}: {status}")
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    db = ArtistDatabase.load(args.db)
    artists = db.get_many()
    if not artists:
        print("No artists tracked yet.")
        return 0

    if args.csv:
        writer = csv.writer(sys.stdout)
        writer.writerow(["id", "name", "works", "last_seen", "last_opened", "url"])
        for artist in artists:
            writer.writerow(
                [
                    artist.id,
                    artist.name or "",
                    len(artist.work_ids),
                    artist.last_seen,
                    artist.last_opened or "",
                    artist.pixiv_url,
                ]
            )
        return 0

    for artist in artists:
        name = f" - {artist.name}" if artist.name else ""
        print(f"{artist.id}{name} | works={len(artist.work_ids)} | last_seen={artist.last_seen}")
    return 0


def cmd_open(args: argparse.Namespace) -> int:
    db = ArtistDatabase.load(args.db)
    artist_ids = args.artist_ids or None
    try:
        artists = db.get_many(artist_ids)
    except KeyError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    if args.limit:
        artists = artists[: args.limit]
    if not artists:
        print("No artists to open.")
        return 0

    urls = [artist.pixiv_url for artist in artists]
    open_urls(
        urls,
        browser=args.browser,
        user_data_dir=args.user_data_dir,
        delay_seconds=args.delay,
    )
    now = utc_now()
    for artist in artists:
        artist.last_opened = now
    db.save()
    print(f"Opened {len(urls)} Pixiv artist page(s). Use the blue Powerful Pixiv Downloader button on each page.")
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    db = ArtistDatabase.load(args.db)
    artist_ids = args.artist_ids or None
    try:
        artists = db.get_many(artist_ids)
    except KeyError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    lines = [artist.pixiv_url if args.format == "urls" else artist.id for artist in artists]
    text = "\n".join(lines) + ("\n" if lines else "")
    if args.output:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(text, encoding="utf-8")
        print(f"Wrote {len(lines)} line(s) to {output.resolve()}")
    else:
        print(text, end="")
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    if not ensure_cookie_consent(args):
        return 2
    try:
        result = check_artist_updates(
            Path(args.db),
            artist_ids=args.artist_ids or None,
            pixiv_cookie=args.pixiv_cookie,
            allow_insecure_ssl_fallback=not args.no_ssl_fallback,
            scan_local=args.scan_local,
            max_pages=args.max_pages if args.max_pages > 0 else None,
        )
    except KeyError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    db = ArtistDatabase.load(args.db)
    artists = db.get_many(args.artist_ids or None)
    print(f"Checked artists: {result.checked}")
    print(f"Artists with updates: {result.artists_with_updates}")
    print(f"New artworks: {result.new_works}")
    if result.ssl_fallback_used:
        print(f"SSL certificate fallback used: {result.ssl_fallback_used}")
    for artist in artists:
        if artist.new_work_ids:
            name = f" - {artist.name}" if artist.name else ""
            print(f"{artist.id}{name}: {len(artist.new_work_ids)} new")
    for error in result.errors:
        print(f"Update check error: {error}", file=sys.stderr)
    return 0 if not result.errors else 1


def cmd_download(args: argparse.Namespace) -> int:
    if not ensure_cookie_consent(args):
        return 2
    try:
        result = download_artist_updates(
            Path(args.db),
            artist_ids=args.artist_ids or None,
            output_root=Path(args.output_root) if args.output_root else None,
            pixiv_cookie=args.pixiv_cookie,
            allow_insecure_ssl_fallback=not args.no_ssl_fallback,
            overwrite=args.overwrite,
            delay_seconds=args.delay,
            separate_restricted=args.separate_r18,
        )
    except KeyError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    print(f"Artists downloaded: {result.artists}")
    print(f"Artworks downloaded: {result.artworks}")
    print(f"Pages saved: {result.pages_saved}")
    print(f"Files skipped: {result.files_skipped}")
    if result.ssl_fallback_used:
        print(f"SSL certificate fallback used: {result.ssl_fallback_used}")
    for error in result.errors:
        print(f"Download error: {error}", file=sys.stderr)
    return 0 if not result.errors else 1


def cmd_similar(args: argparse.Namespace) -> int:
    roots = [Path(root) for root in args.roots]
    missing = [str(root) for root in roots if not root.exists()]
    if missing:
        print(f"Missing path(s): {', '.join(missing)}", file=sys.stderr)
        return 2

    try:
        result = find_similar_images(
            roots,
            exclude_roots=[Path(path) for path in args.exclude],
            threshold=args.threshold,
        )
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(f"Scanned image files: {result.files_seen}")
    print(f"Indexed images: {result.indexed}")
    print(f"Reused from index: {result.reused}")
    print(f"Updated fingerprints: {result.changed}")
    print(f"Similar groups: {len(result.groups)}")
    print(f"Errors: {result.error_count}")
    print(f"Index: {result.index_path.resolve()}")
    for group in result.groups:
        print(
            f"Group {group.id}: {group.kind}, {len(group.entries)} file(s), "
            f"best pHash={group.best_phash_distance}, dHash={group.best_dhash_distance}"
        )
        for entry in group.entries:
            print(f"  {entry.resolution or '?'} {entry.size_bytes} bytes {entry.path}")
    for error in result.errors:
        print(f"Similar image error: {error}", file=sys.stderr)
    if result.error_count > len(result.errors):
        print(f"Similar image errors omitted: {result.error_count - len(result.errors)}", file=sys.stderr)
    if args.output:
        output = Path(args.output)
        write_similar_report(result, output)
        print(f"Wrote similar image report to {output.resolve()}")
    return 0 if not result.error_count else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pixiv-pbd-manager",
        description="Track Pixiv artists and open their pages for Powerful Pixiv Downloader.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    scan = subparsers.add_parser("scan", help="scan downloaded files and remember artist ids")
    add_db_argument(scan)
    scan.add_argument("roots", nargs="+", help="download folder(s) to scan")
    scan.add_argument("--exclude", action="append", default=[], help="folder to skip; can be repeated")
    scan.add_argument("--show-unmatched", action="store_true", help="print examples that could not be identified")
    scan.add_argument("--resolve-online", action="store_true", help="resolve artist ids from artwork ids using Pixiv")
    scan.add_argument("--resolve-limit", type=int, default=3, help="artwork ids to try per name-only folder")
    scan.add_argument("--resolve-delay", type=positive_float, default=0.8, help="seconds between Pixiv resolve requests")
    add_cookie_arguments(scan)
    scan.add_argument("--no-ssl-fallback", action="store_true", help="do not retry with relaxed SSL verification on certificate errors")
    scan.add_argument("--fuzzy-search", action="store_true", help="search Pixiv users by name when artwork-id resolve cannot identify a folder")
    scan.add_argument("--fuzzy-min-score", type=float, default=0.35, help="minimum fuzzy search confidence from 0.0 to 1.0")
    scan.set_defaults(func=cmd_scan)

    watch = subparsers.add_parser("watch", help="keep rescanning while PBD is downloading")
    add_db_argument(watch)
    watch.add_argument("roots", nargs="+", help="download folder(s) to scan")
    watch.add_argument("--exclude", action="append", default=[], help="folder to skip; can be repeated")
    watch.add_argument("--interval", type=positive_float, default=30.0, help="seconds between scans")
    watch.add_argument("--resolve-online", action="store_true", help="resolve artist ids from artwork ids using Pixiv")
    watch.add_argument("--resolve-limit", type=int, default=3, help="artwork ids to try per name-only folder")
    watch.add_argument("--resolve-delay", type=positive_float, default=0.8, help="seconds between Pixiv resolve requests")
    add_cookie_arguments(watch)
    watch.add_argument("--no-ssl-fallback", action="store_true", help="do not retry with relaxed SSL verification on certificate errors")
    watch.add_argument("--fuzzy-search", action="store_true", help="search Pixiv users by name when artwork-id resolve cannot identify a folder")
    watch.add_argument("--fuzzy-min-score", type=float, default=0.35, help="minimum fuzzy search confidence from 0.0 to 1.0")
    watch.set_defaults(func=cmd_watch)

    add = subparsers.add_parser("add", help="manually add a Pixiv artist id")
    add_db_argument(add)
    add.add_argument("artist_id")
    add.add_argument("--name")
    add.set_defaults(func=cmd_add)

    list_cmd = subparsers.add_parser("list", help="list tracked artists")
    add_db_argument(list_cmd)
    list_cmd.add_argument("--csv", action="store_true", help="print CSV")
    list_cmd.set_defaults(func=cmd_list)

    open_cmd = subparsers.add_parser("open", help="open tracked artist pages in the browser")
    add_db_argument(open_cmd)
    open_cmd.add_argument("artist_ids", nargs="*", help="artist ids to open; default opens all tracked artists")
    open_cmd.add_argument("--limit", type=int, help="open only the first N artists")
    open_cmd.add_argument("--delay", type=positive_float, default=1.0, help="seconds between opened tabs")
    open_cmd.add_argument("--browser", help="browser executable path; default uses the system browser")
    open_cmd.add_argument("--user-data-dir", help="Chrome/Edge user data dir that has PBD installed")
    open_cmd.set_defaults(func=cmd_open)

    export = subparsers.add_parser("export", help="export tracked artist ids or URLs")
    add_db_argument(export)
    export.add_argument("artist_ids", nargs="*", help="artist ids to export; default exports all")
    export.add_argument("--format", choices=["ids", "urls"], default="urls")
    export.add_argument("--output", help="output file; default prints to stdout")
    export.set_defaults(func=cmd_export)

    check = subparsers.add_parser("check", help="check tracked artists for new Pixiv artworks")
    add_db_argument(check)
    check.add_argument("artist_ids", nargs="*", help="artist ids to check; default checks all")
    add_cookie_arguments(check)
    check.add_argument("--no-ssl-fallback", action="store_true", help="do not retry with relaxed SSL verification on certificate errors")
    check.add_argument(
        "--scan-local",
        action="store_true",
        help="rescan each artist's saved folder (including subfolders) so works already on disk are not flagged as new",
    )
    check.add_argument(
        "--max-pages",
        type=nonnegative_int,
        default=0,
        help="check only the newest N Pixiv artwork pages per artist; 0 checks all works",
    )
    check.set_defaults(func=cmd_check)

    download = subparsers.add_parser("download", help="download new artworks recorded by update checks")
    add_db_argument(download)
    download.add_argument("artist_ids", nargs="*", help="artist ids to download; default downloads all artists with updates")
    download.add_argument("--output-root", help="fallback output folder for artists without saved paths")
    add_cookie_arguments(download)
    download.add_argument("--no-ssl-fallback", action="store_true", help="do not retry with relaxed SSL verification on certificate errors")
    download.add_argument("--overwrite", action="store_true", help="overwrite existing files")
    download.add_argument("--delay", type=positive_float, default=0.3, help="seconds between image downloads")
    download.add_argument(
        "--separate-r18",
        action="store_true",
        help="save R-18/R-18G works into a separate [R-18&R-18G] subfolder, like Powerful Pixiv Downloader",
    )
    download.set_defaults(func=cmd_download)

    similar = subparsers.add_parser("similar", help="find visually similar image files")
    similar.add_argument("roots", nargs="+", help="image folder(s) to scan")
    similar.add_argument("--exclude", action="append", default=[], help="folder to skip; can be repeated")
    similar.add_argument(
        "--threshold",
        choices=["likely", "possible"],
        default="likely",
        help="similarity threshold; likely is stricter, possible finds more candidates",
    )
    similar.add_argument("--output", help="write a CSV report")
    similar.set_defaults(func=cmd_similar)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)
