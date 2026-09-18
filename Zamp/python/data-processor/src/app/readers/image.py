from __future__ import annotations

import base64
import json
import logging
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from zamp_shared.domain import CanonicalRecord, Schema, SchemaField, SourceFile, SourceReference
from zamp_shared.errors import UnsupportedMimeType
from zamp_shared.images import SUPPORTED_MIME_TYPES, load_for_gemini, normalize_mime
from zamp_shared.llm import GeminiClient, PromptRepository

from app.services.record_parser import parse_records
from .base import SourceReader

log = logging.getLogger(__name__)

PROMPT_NAME = "processing/records_from_image.txt"

__all__ = ["SUPPORTED_MIME_TYPES", "GeminiImageReader"]


class GeminiImageReader(SourceReader):
    """Reads the values out of an image against the schema the user approved.

    The same picture the detector read the shape from is read again here for the
    contents, and for the same reason it is sent as pixels: which value belongs
    to which column is a fact about where things sit on the page.

    Unlike the streaming readers, this one makes a single request and holds the
    result. An image is one page of records, not a file that has to be chunked.
    """

    def __init__(self, client: GeminiClient, prompts: PromptRepository, max_image_bytes: int = 14_000_000):
        self.client, self.prompts, self.max_image_bytes = client, prompts, max_image_bytes

    def read(self, source: SourceFile, local_path: str, schema: Schema) -> Iterator[CanonicalRecord]:
        mime_type = normalize_mime(source.mime_type)
        if mime_type not in SUPPORTED_MIME_TYPES:
            raise UnsupportedMimeType(f"Image record extraction does not support {mime_type}")

        blob, sent_as = load_for_gemini(Path(local_path), mime_type, source.filename, self.max_image_bytes)
        parts: list[dict[str, Any]] = [
            {"inline_data": {"mime_type": sent_as, "data": base64.b64encode(blob).decode()}},
            {"text": self._prompt(source, schema)},
        ]
        log.info("requesting image records", extra={"mimeType": sent_as, "bytes": len(blob), "fileId": source.id})

        records = parse_records(self.client.generate(parts), schema)
        return iter([
            CanonicalRecord(values=values, source_reference=SourceReference(row_number=number))
            for number, values in enumerate(records, start=1)
        ])

    def _prompt(self, source: SourceFile, schema: Schema) -> str:
        template = self.prompts.load(PROMPT_NAME)
        return (template.replace("{{SCHEMA}}", _describe(schema))
                        .replace("{{FILENAME}}", source.filename)
                        .replace("{{MIME_TYPE}}", source.mime_type))


def _describe(schema: Schema) -> str:
    """The approved schema, as the field list the model has to fill in.

    Only what tells the model what to look for. Sending the stored schema
    verbatim would also send `aliases` and `origin`, which invite it to answer
    under a different key than the one the mapper will look for.
    """
    return json.dumps({"name": schema.name, "fields": [_describe_field(f) for f in schema.fields]}, indent=2)


def _describe_field(field: SchemaField) -> dict[str, Any]:
    described: dict[str, Any] = {"name": field.name, "type": field.type, "required": field.required}
    if field.description:
        described["description"] = field.description
    if field.fields:
        described["fields"] = [_describe_field(nested) for nested in field.fields]
    # Both, when both are set. `item_fields` alone never says the items are
    # objects, and the model answers with a flat list of scalars instead.
    if field.item_type:
        described["item_type"] = field.item_type
    if field.item_fields:
        described["item_fields"] = [_describe_field(nested) for nested in field.item_fields]
    return described
