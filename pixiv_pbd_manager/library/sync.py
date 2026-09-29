"""Conservative scoped reconciliation: an incomplete walk never proves deletion."""

import os
from pathlib import Path
import time

from ..scanner import is_relative_to
from ..similar.filewalk import IMAGE_SUFFIXES


def within(path, roots):
    return any(is_relative_to(path, root) for root in roots)


def excluded(path, roots, excludes):
    return not within(path.resolve(), roots) or within(path.resolve(), excludes) or path.is_symlink()


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
    found, completed, unavailable = {}, [], []
    for scope, recursive in scopes:
        if excluded(scope, roots, excludes):
            continue
        root = next((root for root in roots if is_relative_to(scope, root)), scope)
        errors = []
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
            pending = [scope]
            while pending:
                if cancelled():
                    from .annotation_identity import ProtectionCancelled
                    raise ProtectionCancelled()
                folder = pending.pop()
                try:
                    with os.scandir(folder) as entries:
                        for entry in entries:
                            path = Path(entry.path)
                            if entry.is_symlink():
                                continue
                            if entry.is_dir(follow_symlinks=False):
                                if recursive and not excluded(path, roots, excludes):
                                    pending.append(path)
                            elif path.suffix.lower() in IMAGE_SUFFIXES and not within(path, excludes):
                                # The parent was already resolved/validated. Do
                                # not resolve every regular file again on Windows.
                                stat = entry.stat(follow_symlinks=False)
                                found[str(path)] = (stat.st_size, stat.st_mtime_ns)
                except OSError as exc:
                    errors.append(str(exc))
        except OSError as exc:
            errors.append(str(exc))
        if errors:
            unavailable.append({"path": str(scope), "error": errors[0]})
        else:
            completed.append((scope, recursive))
    return found, completed, unavailable


def covered(path, scopes):
    path = Path(path)
    return any(is_relative_to(path, scope) if recursive else path.parent == scope for scope, recursive in scopes)


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
    changed = {path: sig for path, sig in found.items() if path not in old or sig != (old[path].size_bytes, old[path].mtime_ns)}
    if changed:
        wait(1)
    stable, pending = [], []
    for path, sig in found.items():
        try:
            stat = Path(path).stat()
            if (stat.st_size, stat.st_mtime_ns) != sig:
                pending.append(path)
            else:
                stable.append(Path(path))
        except OSError:
            pending.append(path)
    return stable, pending
