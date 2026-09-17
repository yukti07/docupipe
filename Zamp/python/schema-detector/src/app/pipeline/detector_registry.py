from zamp_shared.errors import UnsupportedMimeType
from app.detectors.base import SchemaDetector


class DetectorRegistry:
    def __init__(self, detectors: dict[str, SchemaDetector], fallback: SchemaDetector | None = None): self.detectors, self.fallback = detectors, fallback

    def resolve(self, mime_type: str, filename: str = "") -> SchemaDetector:
        normalized = mime_type.split(";", 1)[0].strip().lower()
        detector = self.detectors.get(normalized)
        if detector: return detector

        extension_types = {
            ".csv": "text/csv",
            ".json": "application/json",
            ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }
        extension = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        detector = self.detectors.get(extension_types.get(extension, ""))
        if detector: return detector
        if self.fallback: return self.fallback
        raise UnsupportedMimeType(f"Schema detection does not support {mime_type or filename}")
