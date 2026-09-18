from zamp_shared.errors import UnsupportedMimeType
from zamp_shared.mime import EXTENSION_TYPES, extension_of
from app.detectors.base import SchemaDetector


class DetectorRegistry:
    def __init__(self, detectors: dict[str, SchemaDetector], fallback: SchemaDetector | None = None): self.detectors, self.fallback = detectors, fallback

    def resolve(self, mime_type: str, filename: str = "") -> SchemaDetector:
        normalized = mime_type.split(";", 1)[0].strip().lower()
        detector = self.detectors.get(normalized)
        if detector: return detector

        detector = self.detectors.get(EXTENSION_TYPES.get(extension_of(filename), ""))
        if detector: return detector
        if self.fallback: return self.fallback
        raise UnsupportedMimeType(f"Schema detection does not support {mime_type or filename}")
