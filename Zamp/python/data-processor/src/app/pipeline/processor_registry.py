from zamp_shared.errors import UnsupportedMimeType
from app.readers.base import SourceReader

#: The same fallback the detector uses. The backend guesses a content type
#: from the extension, so the two have to agree on what an extension means or
#: a file the detector read is one the processor refuses.
EXTENSION_TYPES = {
    ".csv": "text/csv",
    ".json": "application/json",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


class ProcessorRegistry:
    def __init__(self, readers: dict[str, SourceReader]): self.readers = readers

    def resolve(self, mime_type: str, filename: str = "") -> SourceReader:
        # `text/csv; charset=utf-8` is the same reader as `text/csv`.
        normalized = (mime_type or "").split(";", 1)[0].strip().lower()
        reader = self.readers.get(normalized)
        if reader: return reader

        extension = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        reader = self.readers.get(EXTENSION_TYPES.get(extension, ""))
        if reader: return reader
        raise UnsupportedMimeType(f"Data processing does not support {mime_type or filename}")
