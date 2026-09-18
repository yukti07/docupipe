"""The one extension-to-MIME table both workers read.

The backend types an upload from its extension, so the detector and the
processor have to agree on what an extension means. When they disagree the
failure is quiet and confusing: the detector reads the file and moves it to
SCHEMA_READY, then Convert refuses it as `UNSUPPORTED_MIME_TYPE`. Two copies of
this table drift; one cannot.
"""

from __future__ import annotations

EXTENSION_TYPES: dict[str, str] = {
    ".csv": "text/csv",
    ".json": "application/json",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".heic": "image/heic",
    ".heif": "image/heif",
}


def extension_of(filename: str) -> str:
    return "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
