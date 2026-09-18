from zamp_shared.errors import UnsupportedMimeType
from zamp_shared.mime import EXTENSION_TYPES, extension_of
from app.readers.base import SourceReader


class ProcessorRegistry:
    def __init__(self, readers: dict[str, SourceReader]): self.readers = readers

    def resolve(self, mime_type: str, filename: str = "") -> SourceReader:
        # `text/csv; charset=utf-8` is the same reader as `text/csv`.
        normalized = (mime_type or "").split(";", 1)[0].strip().lower()
        reader = self.readers.get(normalized)
        if reader: return reader

        reader = self.readers.get(EXTENSION_TYPES.get(extension_of(filename), ""))
        if reader: return reader
        raise UnsupportedMimeType(f"Data processing does not support {mime_type or filename}")
