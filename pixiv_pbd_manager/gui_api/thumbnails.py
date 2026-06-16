"""Pillow-based image thumbnailing for the GUI preview & list cells.

Returns a data URL (base64 inline) so the frontend can put it directly in
``<img src=...>`` without a follow-up file:// request.
"""

from __future__ import annotations

import base64
from io import BytesIO
import math
from pathlib import Path
import warnings


def _pillow():
    from PIL import Image, ImageChops, ImageOps

    Image.MAX_IMAGE_PIXELS = None
    warnings.simplefilter("ignore", Image.DecompressionBombWarning)
    return Image, ImageChops, ImageOps


def _encode_image(image, *, prefer_jpeg: bool = True) -> tuple[str, str]:
    output = BytesIO()
    if prefer_jpeg and image.mode not in ("RGBA", "LA") and not (image.mode == "P" and "transparency" in image.info):
        image.convert("RGB").save(output, format="JPEG", quality=84, optimize=True)
        mime = "image/jpeg"
    else:
        image.convert("RGBA").save(output, format="PNG", optimize=True)
        mime = "image/png"
    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return f"data:{mime};base64,{encoded}", mime


def _resize_for_preview(
    Image,
    image,
    max_size: int,
    *,
    target_width: int | None = None,
    max_pixels: int | None = None,
):
    width, height = image.size
    if target_width and target_width > 0 and width > 0 and height > 0:
        scale = min(1.0, target_width / width, max_size / max(width, height))
        if max_pixels and max_pixels > 0:
            scale = min(scale, math.sqrt(max_pixels / (width * height)))
        if scale < 1.0:
            next_size = (max(1, round(width * scale)), max(1, round(height * scale)))
            return image.resize(next_size, Image.Resampling.LANCZOS)
        return image.copy()

    image = image.copy()
    image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
    return image


def _open_preview_image(
    path: Path,
    max_size: int,
    *,
    target_width: int | None = None,
    max_pixels: int | None = None,
):
    Image, _ImageChops, ImageOps = _pillow()
    with Image.open(path) as image:
        try:
            image.seek(0)
        except EOFError:
            pass
        image = ImageOps.exif_transpose(image)
        width, height = image.size
        preview = _resize_for_preview(
            Image,
            image,
            max_size,
            target_width=target_width,
            max_pixels=max_pixels,
        )
        return preview, width, height


def image_thumbnail(
    path: Path,
    max_size: int,
    *,
    target_width: int | None = None,
    max_pixels: int | None = None,
) -> tuple[str, int, int]:
    image, width, height = _open_preview_image(
        path,
        max_size,
        target_width=target_width,
        max_pixels=max_pixels,
    )
    data_url, _mime = _encode_image(image)
    return data_url, width, height


def image_difference(base_path: Path, compare_path: Path, max_size: int) -> tuple[str, int, int]:
    Image, ImageChops, ImageOps = _pillow()
    base, _base_width, _base_height = _open_preview_image(base_path, max_size)
    compare, _compare_width, _compare_height = _open_preview_image(compare_path, max_size)

    # Align the comparison image to the base dimensions so the per-pixel diff
    # reflects content differences (compression, edits) rather than a size or
    # letterbox mismatch. The base image defines the diff canvas.
    base_rgb = base.convert("RGB")
    compare_rgb = compare.convert("RGB")
    if compare_rgb.size != base_rgb.size:
        compare_rgb = compare_rgb.resize(base_rgb.size, Image.Resampling.LANCZOS)

    diff = ImageChops.difference(base_rgb, compare_rgb)
    diff = ImageOps.autocontrast(diff)
    data_url, _mime = _encode_image(diff, prefer_jpeg=False)
    return data_url, base_rgb.width, base_rgb.height
