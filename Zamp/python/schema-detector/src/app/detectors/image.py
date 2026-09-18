from __future__ import annotations

import base64
import logging
from pathlib import Path
from typing import Any

from zamp_shared.domain import Schema, SchemaDetectionContext
from zamp_shared.errors import UnsupportedMimeType
from zamp_shared.images import SUPPORTED_MIME_TYPES, load_for_gemini, normalize_mime
from zamp_shared.llm import GeminiClient, PromptRepository

from app.services.schema_parser import parse_schema
from .base import SchemaDetector

log = logging.getLogger(__name__)

PROMPT_NAME = "schema/schema_from_image.txt"

__all__ = ["SUPPORTED_MIME_TYPES", "GeminiImageSchemaDetector"]


class GeminiImageSchemaDetector(SchemaDetector):
    """Infers the structure an image *represents*, not the text it contains.

    The image goes to Gemini as pixels. That is the whole point: column
    alignment, label-to-value adjacency, repeated row positions and table
    boundaries are the evidence a schema is read from, and every one of them is
    destroyed by extracting text first. No OCR runs anywhere in this path.
    """

    def __init__(self, client: GeminiClient, prompts: PromptRepository, max_image_bytes: int = 14_000_000):
        self.client, self.prompts, self.max_image_bytes = client, prompts, max_image_bytes

    def detect(self, context: SchemaDetectionContext) -> Schema:
        mime_type = normalize_mime(context.source_file.mime_type)
        if mime_type not in SUPPORTED_MIME_TYPES:
            raise UnsupportedMimeType(f"Image schema detection does not support {mime_type}")

        blob, sent_as = load_for_gemini(Path(context.local_path), mime_type,
                                        context.source_file.filename, self.max_image_bytes)
        parts: list[dict[str, Any]] = [
            {"inline_data": {"mime_type": sent_as, "data": base64.b64encode(blob).decode()}},
            {"text": self._prompt(context)},
        ]
        log.info("requesting image schema", extra={"mimeType": sent_as, "bytes": len(blob),
                                                   "fileId": context.source_file.id})
        return parse_schema(self.client.generate(parts), format_override="image")

    def _prompt(self, context: SchemaDetectionContext) -> str:
        template = self.prompts.load(PROMPT_NAME)
        return (template.replace("{{FILENAME}}", context.source_file.filename)
                        .replace("{{MIME_TYPE}}", context.source_file.mime_type))
