"""Pair-detection and clustering of similar fingerprints.

The interesting structure: a BK-tree indexed by phash + Union-Find to merge
candidate pairs into connected components. We always pre-cluster by SHA-256
first so byte-identical files form one ``exact`` group regardless of pHash
fuzz.

Tuning knobs ``LIKELY_LIMITS`` and ``POSSIBLE_LIMITS`` are (phash_max,
dhash_max). Pairs must satisfy *both* thresholds to enter that bucket.
"""

from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from ..events import PROGRESS_SIMILAR_MATCH, PROGRESS_SIMILAR_MATCH_START
from ._shared import ProgressCallback, emit
from .fingerprint import ImageFingerprint


LIKELY_LIMITS = (6, 10)
POSSIBLE_LIMITS = (10, 14)
PIXIV_PAGE_NAME_PATTERN = re.compile(r"(?<!\d)(?P<pid>\d{4,12})_p(?P<page>\d+)(?!\d)", re.IGNORECASE)


@dataclass(frozen=True)
class SimilarPair:
    left: str
    right: str
    kind: str
    phash_distance: int
    dhash_distance: int


@dataclass
class SimilarGroup:
    id: int
    kind: str
    entries: list[ImageFingerprint] = field(default_factory=list)
    best_phash_distance: int = 0
    best_dhash_distance: int = 0


def group_signature(entries: list[ImageFingerprint]) -> str:
    """Return a path-independent signature that changes with group content."""
    tokens = sorted(
        f"{entry.sha256}:{entry.size_bytes}:{entry.width}x{entry.height}"
        for entry in entries
    )
    return hashlib.sha256("\n".join(tokens).encode("ascii")).hexdigest()


def cleanup_recommendation(group: SimilarGroup) -> tuple[str | None, list[str], int]:
    """Return the preferred keep path, suggested removals, and reclaim bytes."""
    if len(group.entries) < 2 or group.kind == "possible":
        return None, [], 0

    if group.kind == "likely":
        ratios = [
            entry.width / entry.height
            for entry in group.entries
            if entry.width > 0 and entry.height > 0
        ]
        if len(ratios) != len(group.entries):
            return None, [], 0
        smallest = min(ratios)
        largest = max(ratios)
        if smallest <= 0 or (largest - smallest) / smallest > 0.02:
            return None, [], 0

    ranked = sorted(
        group.entries,
        key=lambda entry: (
            -(entry.width * entry.height),
            -entry.size_bytes,
            -entry.mtime_ns,
            entry.path.casefold(),
        ),
    )
    keep_path = ranked[0].path
    remove_paths = [entry.path for entry in ranked[1:]]
    reclaim_bytes = sum(entry.size_bytes for entry in ranked[1:])
    return keep_path, remove_paths, reclaim_bytes


def popcount(value: int) -> int:
    return bin(value).count("1")


def hamming_hex(left: str, right: str) -> int:
    return popcount(int(left, 16) ^ int(right, 16))


class UnionFind:
    def __init__(self, size: int) -> None:
        self.parent = list(range(size))

    def find(self, value: int) -> int:
        while self.parent[value] != value:
            self.parent[value] = self.parent[self.parent[value]]
            value = self.parent[value]
        return value

    def union(self, left: int, right: int) -> None:
        root_left = self.find(left)
        root_right = self.find(right)
        if root_left != root_right:
            self.parent[root_right] = root_left


class BKTree:
    """Burkhard-Keller tree over Hamming distance for fast near-neighbour query."""

    def __init__(self) -> None:
        self.root: dict[str, Any] | None = None

    def add(self, value: int, index: int) -> None:
        node = {"value": value, "indices": [index], "children": {}}
        if self.root is None:
            self.root = node
            return
        current = self.root
        while True:
            distance = popcount(current["value"] ^ value)
            if distance == 0:
                current["indices"].append(index)
                return
            child = current["children"].get(distance)
            if child is None:
                current["children"][distance] = node
                return
            current = child

    def query(self, value: int, max_distance: int) -> list[int]:
        if self.root is None:
            return []
        found: list[int] = []
        stack = [self.root]
        while stack:
            node = stack.pop()
            distance = popcount(node["value"] ^ value)
            if distance <= max_distance:
                found.extend(node["indices"])
            low = distance - max_distance
            high = distance + max_distance
            for child_distance, child in node["children"].items():
                if low <= child_distance <= high:
                    stack.append(child)
        return found


def pair_kind(phash_distance: int, dhash_distance: int) -> str | None:
    if phash_distance <= LIKELY_LIMITS[0] and dhash_distance <= LIKELY_LIMITS[1]:
        return "likely"
    if phash_distance <= POSSIBLE_LIMITS[0] and dhash_distance <= POSSIBLE_LIMITS[1]:
        return "possible"
    return None


def pixiv_page_key(path) -> tuple[str, int] | None:
    """Return (work_id, page_index) for a Pixiv-style ``{pid}_p{N}`` filename."""
    from pathlib import Path

    match = PIXIV_PAGE_NAME_PATTERN.search(Path(path).stem)
    if not match:
        return None
    return match.group("pid"), int(match.group("page"))


def should_skip_pixiv_page_pair(left: ImageFingerprint, right: ImageFingerprint) -> bool:
    """Two pages of the same Pixiv work shouldn't be flagged as duplicates of each other."""
    left_key = pixiv_page_key(left.path)
    right_key = pixiv_page_key(right.path)
    return bool(left_key and right_key and left_key[0] == right_key[0] and left_key[1] != right_key[1])


def build_similar_groups(
    entries: list[ImageFingerprint],
    *,
    threshold: str = "likely",
    skip_same_pixiv_work_pages: bool = False,
    progress_callback: ProgressCallback | None = None,
    progress_interval: int = 1000,
) -> list[SimilarGroup]:
    if len(entries) < 2:
        return []

    include_possible = threshold == "possible"
    max_phash_distance = POSSIBLE_LIMITS[0] if include_possible else LIKELY_LIMITS[0]
    union_find = UnionFind(len(entries))
    pairs: list[SimilarPair] = []
    emit(progress_callback, PROGRESS_SIMILAR_MATCH_START, total=len(entries))

    # SHA-256 collisions form the seed clusters. They're always "exact",
    # regardless of how the pHash/dHash distances would have classified them.
    sha_groups: dict[str, list[int]] = defaultdict(list)
    for index, entry in enumerate(entries):
        sha_groups[entry.sha256].append(index)
    for indices in sha_groups.values():
        if len(indices) < 2:
            continue
        for offset, left_index in enumerate(indices):
            for right_index in indices[offset + 1 :]:
                if skip_same_pixiv_work_pages and should_skip_pixiv_page_pair(entries[left_index], entries[right_index]):
                    continue
                union_find.union(left_index, right_index)
                pairs.append(SimilarPair(entries[left_index].path, entries[right_index].path, "exact", 0, 0))

    # Visual-similarity pass via BK-tree on pHash. dHash is checked as a
    # second gate so a single hash collision doesn't claim a false positive.
    tree = BKTree()
    for index, entry in enumerate(entries):
        phash_value = int(entry.phash, 16)
        for candidate_index in tree.query(phash_value, max_phash_distance):
            candidate = entries[candidate_index]
            if candidate.sha256 == entry.sha256:
                continue
            if skip_same_pixiv_work_pages and should_skip_pixiv_page_pair(candidate, entry):
                continue
            phash_distance = hamming_hex(candidate.phash, entry.phash)
            dhash_distance = hamming_hex(candidate.dhash, entry.dhash)
            kind = pair_kind(phash_distance, dhash_distance)
            if kind == "possible" and not include_possible:
                continue
            if kind:
                union_find.union(candidate_index, index)
                pairs.append(SimilarPair(candidate.path, entry.path, kind, phash_distance, dhash_distance))
        tree.add(phash_value, index)
        if progress_callback and progress_interval > 0 and (index + 1) % progress_interval == 0:
            emit(
                progress_callback,
                PROGRESS_SIMILAR_MATCH,
                current=index + 1,
                total=len(entries),
                pairs=len(pairs),
            )
    emit(progress_callback, PROGRESS_SIMILAR_MATCH, current=len(entries), total=len(entries), pairs=len(pairs))

    grouped_indices: dict[int, list[int]] = defaultdict(list)
    for index in range(len(entries)):
        grouped_indices[union_find.find(index)].append(index)

    pair_by_root: dict[int, list[SimilarPair]] = defaultdict(list)
    path_to_index = {entry.path: index for index, entry in enumerate(entries)}
    for pair in pairs:
        left_root = union_find.find(path_to_index[pair.left])
        pair_by_root[left_root].append(pair)

    groups: list[SimilarGroup] = []
    priority = {"exact": 0, "likely": 1, "possible": 2}
    for indices in grouped_indices.values():
        if len(indices) < 2:
            continue
        root = union_find.find(indices[0])
        group_pairs = pair_by_root.get(root, [])
        best_kind = min((pair.kind for pair in group_pairs), key=lambda value: priority[value], default="possible")
        visual_pairs = [pair for pair in group_pairs if pair.kind != "exact"]
        best_phash = min((pair.phash_distance for pair in visual_pairs), default=0)
        best_dhash = min((pair.dhash_distance for pair in visual_pairs), default=0)
        groups.append(
            SimilarGroup(
                id=len(groups) + 1,
                kind=best_kind,
                entries=sorted((entries[index] for index in indices), key=lambda item: item.path.lower()),
                best_phash_distance=best_phash,
                best_dhash_distance=best_dhash,
            )
        )
    return sorted(groups, key=lambda group: (priority[group.kind], -len(group.entries), group.id))
