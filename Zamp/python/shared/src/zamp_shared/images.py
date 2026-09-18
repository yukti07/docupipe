"""Getting an image into a Gemini request without losing what makes it readable.

Both workers send the same images to the same API: the detector to learn the
shape, the processor to read the values out of it. The rules about what Gemini
accepts and what has to be re-encoded belong in one place.
"""

from __future__ import annotations

import io
import logging
from pathlib import Path

from .errors import InvalidInput

log = logging.getLogger(__name__)

#: What Gemini accepts as inline image data. Anything else is a 400.
NATIVE_IMAGE_MIME_TYPES = frozenset({"image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"})

#: Real image formats Gemini will not take. They are re-encoded rather than
#: dropped, because the alternative is worse: an unroutable image falls through
#: to the text path and reaches the model as mojibake.
TRANSCODED_MIME_TYPES = frozenset({"image/bmp", "image/tiff"})

SUPPORTED_MIME_TYPES = NATIVE_IMAGE_MIME_TYPES | TRANSCODED_MIME_TYPES


def normalize_mime(mime_type: str) -> str:
    return (mime_type or "").split(";", 1)[0].strip().lower()


def load_for_gemini(path: Path, mime_type: str, filename: str, max_bytes: int) -> tuple[bytes, str]:
    """The bytes to send and the type they are actually in.

    Size is checked from the directory entry before anything is read, so an
    oversized image is refused rather than pulled into memory to be measured.
    """
    if path.stat().st_size > max_bytes:
        raise InvalidInput(f"{filename} is too large to send to Gemini inline", "GEMINI_FILE_TOO_LARGE")

    blob = path.read_bytes()
    if mime_type in NATIVE_IMAGE_MIME_TYPES:
        return blob, mime_type

    converted = to_png(blob, filename)
    # PNG of a compressed source can be bigger than the source, so the cap has
    # to hold against what is actually sent, not what was read.
    if len(converted) > max_bytes:
        raise InvalidInput(f"{filename} is too large to send to Gemini inline", "GEMINI_FILE_TOO_LARGE")
    log.info("transcoded image for gemini", extra={"from": mime_type, "to": "image/png",
                                                    "sourceBytes": len(blob), "sentBytes": len(converted)})
    return converted, "image/png"


def to_png(blob: bytes, filename: str) -> bytes:
    """Lossless re-encode. No resizing, no quality loss, no resampling.

    Resolution is what makes a photographed table readable as a table, so the
    pixels are carried across untouched and only the container changes.
    """
    from PIL import Image, UnidentifiedImageError  # here, so shared imports without Pillow

    try:
        with Image.open(io.BytesIO(blob)) as image:
            # A multi-frame TIFF opens on its first frame, which is the page a
            # scanner writes. Later pages are not sent; see the docs.
            frame = image.convert("RGBA" if image.mode in ("RGBA", "LA", "P") else "RGB")
            buffer = io.BytesIO()
            frame.save(buffer, format="PNG", optimize=True)
            return buffer.getvalue()
    except UnidentifiedImageError as exc:
        raise InvalidInput(f"{filename} could not be read as an image", "INVALID_INPUT") from exc
    except OSError as exc:
        raise InvalidInput(f"{filename} is a damaged or truncated image", "INVALID_INPUT") from exc
