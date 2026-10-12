"""Conservative scoped reconciliation: an incomplete walk never proves deletion."""

import os
from pathlib import Path
import time

from ..scanner import is_relative_to
from ..similar.filewalk import IMAGE_SUFFIXES


def within(path, roots):
    return any(is_relative_to(path, root) for root in roots)


def excluded(resolved, roots, excludes):
    return not within(resolved, roots) or within(resolved, excludes)


def _prefix(value):
    return os.path.normcase(os.path.join(str(value), ""))


def outside(paths, roots, excludes):
    """excluded() for many normalized path strings, as plain prefix tests."""
    inside, skipped = tuple(map(_prefix, roots)), tuple(map(_prefix, excludes))
    return {path for path in paths if not (text := _prefix(path)).startswith(inside) or text.startswith(skipped)}


def scopes_for(changed, roots, full=False):
    if full:
        return [(root, True) for root in roots]
    scopes = {}
    for text in changed:
        path = Path(text).resolve()
        if not within(path, roots):
            continue
        if path.suffix.lower() in IMAGE_SUFFIXES or path.is_file():
            scopes.setdefault(path.parent, False)
        else:
            scopes[path] = True
            if within(path.parent, roots):
                scopes.setdefault(path.parent, False)
    return [(path, recursive) for path, recursive in scopes.items()
            if not any(parent != path and recurse and is_relative_to(path, parent) for parent, recurse in scopes.items())]


def discover(scopes, roots, excludes, cancelled):
    """Return files found, scopes walked, unreadable subfolders and unavailable scopes."""
    found, completed, unreadable, unavailable = {}, [], [], []
    for scope, recursive in scopes:
        if excluded(scope, roots, excludes):
            continue
        root = next((root for root in roots if is_relative_to(scope, root)), scope)
        try:
            # Probe root access separately: missing mounts are not deleted files.
            with os.scandir(root) as entries:
                next(entries, None)
            if not scope.exists():
                ancestor = scope.parent
                while not ancestor.exists() and ancestor != root:
                    ancestor = ancestor.parent
                with os.scandir(ancestor) as entries:
                    list(entries)
                completed.append((scope, recursive))
                continue
            pending, walked = [scope], set()
            while pending:
                if cancelled():
                    from .annotation_identity import ProtectionCancelled
                    raise ProtectionCancelled()
                folder = pending.pop()
                if os.path.normcase(str(folder)) in walked:
                    continue  # a junction back into this walk
                walked.add(os.path.normcase(str(folder)))
                try:
                    with os.scandir(folder) as entries:
                        for entry in entries:
                            path = Path(entry.path)
                            if entry.is_symlink():
                                continue
                            if entry.is_dir(follow_symlinks=False):
                                if recursive:
                                    # Junctions are not symlinks: descend by the resolved
                                    # target so file keys match build_catalog's paths.
                                    target = path.resolve()
                                    if not excluded(target, roots, excludes):
                                        pending.append(target)
                            elif path.suffix.lower() in IMAGE_SUFFIXES:
                                # Excluded folders are never entered, as in a full
                                # scan, and the parent is already resolved; do not
                                # test or resolve every file again on Windows.
                                stat = entry.stat(follow_symlinks=False)
                                found[str(path)] = (stat.st_size, stat.st_mtime_ns)
                except OSError:
                    if folder == scope:
                        raise
                    # A subfolder that cannot be listed (System Volume Information,
                    # a legacy junction) proves nothing below it, but it does not
                    # make the rest of the scope unavailable.
                    unreadable.append(folder)
        except OSError as exc:
            unavailable.append({"path": str(scope), "error": str(exc)})
        else:
            completed.append((scope, recursive))
    return found, completed, unreadable, unavailable


def covered(paths, scopes):
    """The normalized paths a completed walk of `scopes` would have listed:
    anywhere under a recursive scope, or directly inside a flat one."""
    deep = tuple(_prefix(scope) for scope, recursive in scopes if recursive)
    flat = {os.path.normcase(str(scope)) for scope, recursive in scopes if not recursive}
    return {path for path in paths if _prefix(path).startswith(deep) or os.path.normcase(os.path.dirname(path)) in flat}


def confirm_missing(paths, roots):
    missing, unavailable, probed = set(), [], {}
    for text in paths:
        path = Path(text)
        root = next((root for root in roots if is_relative_to(path, root)), None)
        if root is None:
            continue
        try:
            if root not in probed:
                with os.scandir(root) as entries:
                    next(entries, None)
                probed[root] = True
            if not probed[root]:
                continue
            try:
                path.stat()
                continue
            except FileNotFoundError:
                pass
            parent = path.parent
            while not parent.exists() and parent != root:
                parent = parent.parent
            with os.scandir(parent) as entries:
                list(entries)
            missing.add(text)
        except OSError as exc:
            probed[root] = False
            unavailable.append({"path": str(root), "error": str(exc)})
    return {path for path in missing if all(probed[root] for root in probed if is_relative_to(Path(path), root))}, unavailable


def stable_files(found, old, wait=time.sleep):
    """Split new or modified files into settled and still-changing ones. Files
    matching their index entry need no rebuild and are in neither list."""
    changed = {path: sig for path, sig in found.items() if path not in old or sig != (old[path].size_bytes, old[path].mtime_ns)}
    if changed:
        wait(1)
    stable, pending = [], []
    for path, sig in changed.items():
        try:
            stat = Path(path).stat()
            if (stat.st_size, stat.st_mtime_ns) != sig:
                pending.append(path)
            else:
                stable.append(Path(path))
        except OSError:
            pending.append(path)
    return stable, pending
