"""Pillow-based image thumbnailing for the GUI preview & list cells.

Returns a data URL (base64 inline) so the frontend can put it directly in
``<img src=...>`` without a follow-up file:// request.
"""

from __future__ import annotations

import base64
from io import BytesIO
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


def _open_preview_image(path: Path, max_size: int):
    Image, _ImageChops, ImageOps = _pillow()
    with Image.open(path) as image:
        try:
            image.seek(0)
        except EOFError:
            pass
        image = ImageOps.exif_transpose(image)
        width, height = image.size
        image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        return image.copy(), width, height


def image_thumbnail(path: Path, max_size: int) -> tuple[str, int, int]:
    image, width, height = _open_preview_image(path, max_size)
    data_url, _mime = _encode_image(image)
    return data_url, width, height


def image_difference(base_path: Path, compare_path: Path, max_size: int) -> tuple[str, int, int]:
    Image, ImageChops, ImageOps = _pillow()
    base, _base_width, _base_height = _open_preview_image(base_path, max_size)
    compare, _compare_width, _compare_height = _open_preview_image(compare_path, max_size)

    width = max(base.width, compare.width)
    height = max(base.height, compare.height)

    def centered_canvas(image):
        canvas = Image.new("RGB", (width, height), "black")
        rgb = image.convert("RGB")
        canvas.paste(rgb, ((width - rgb.width) // 2, (height - rgb.height) // 2))
        return canvas

    diff = ImageChops.difference(centered_canvas(base), centered_canvas(compare))
    diff = ImageOps.autocontrast(diff)
    data_url, _mime = _encode_image(diff, prefer_jpeg=False)
    return data_url, width, height
