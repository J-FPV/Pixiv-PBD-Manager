"""Pillow-based image thumbnailing for the GUI preview & list cells.

Returns a data URL (base64 inline) so the frontend can put it directly in
``<img src=...>`` without a follow-up file:// request.
"""

from __future__ import annotations

import base64
from io import BytesIO
from pathlib import Path


def image_thumbnail(path: Path, max_size: int) -> tuple[str, int, int]:
    from PIL import Image, ImageOps

    with Image.open(path) as image:
        try:
            image.seek(0)
        except EOFError:
            pass
        image = ImageOps.exif_transpose(image)
        width, height = image.size
        image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

        output = BytesIO()
        if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
            image.convert("RGBA").save(output, format="PNG", optimize=True)
            mime = "image/png"
        else:
            image.convert("RGB").save(output, format="JPEG", quality=84, optimize=True)
            mime = "image/jpeg"

    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return f"data:{mime};base64,{encoded}", width, height
