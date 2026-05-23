"""Visual similar-image detection across the local library.

The package is split into focused modules; this ``__init__`` re-exports the
public surface so existing callers (CLI, GUI, tests, and the
``from pixiv_pbd_manager.similar import ...`` patterns scattered through the
codebase) keep working unchanged after the split.
"""

from ._shared import ProgressCallback
from .filewalk import IMAGE_SUFFIXES, iter_image_files
from .fingerprint import (
    ImageFingerprint,
    ensure_image_dependencies,
    fingerprint_image,
    image_hashes,
    is_reusable,
    sha256_file,
)
from .grouping import (
    LIKELY_LIMITS,
    PIXIV_PAGE_NAME_PATTERN,
    POSSIBLE_LIMITS,
    BKTree,
    SimilarGroup,
    SimilarPair,
    UnionFind,
    build_similar_groups,
    hamming_hex,
    pair_kind,
    pixiv_page_key,
    popcount,
    should_skip_pixiv_page_pair,
)
from .index import DEFAULT_IMAGE_INDEX, load_image_index, save_image_index
from .runner import SimilarImageResult, find_similar_images, write_similar_report


__all__ = [
    # public workflow
    "find_similar_images",
    "write_similar_report",
    "SimilarImageResult",
    # data shapes
    "ImageFingerprint",
    "SimilarPair",
    "SimilarGroup",
    # walking / indexing
    "iter_image_files",
    "IMAGE_SUFFIXES",
    "load_image_index",
    "save_image_index",
    "DEFAULT_IMAGE_INDEX",
    # fingerprint primitives (used by tests)
    "fingerprint_image",
    "image_hashes",
    "is_reusable",
    "sha256_file",
    "ensure_image_dependencies",
    # grouping primitives (used by tests)
    "build_similar_groups",
    "hamming_hex",
    "popcount",
    "pair_kind",
    "pixiv_page_key",
    "should_skip_pixiv_page_pair",
    "UnionFind",
    "BKTree",
    "LIKELY_LIMITS",
    "POSSIBLE_LIMITS",
    "PIXIV_PAGE_NAME_PATTERN",
    # types
    "ProgressCallback",
]
