"""Extract PDF records using the approved database schema and original bytes."""
from __future__ import annotations

import base64
from collections.abc import Iterator
from pathlib import Path

from zamp_shared.domain import CanonicalRecord, Schema, SourceFile, SourceReference
from zamp_shared.errors import InvalidInput, UnsupportedMimeType
from zamp_shared.llm import GeminiClient, PromptRepository
from app.services.record_parser import parse_records
from .base import SourceReader


class GeminiPdfReader(SourceReader):
    def __init__(self, client: GeminiClient, prompts: PromptRepository, max_pdf_bytes: int = 14_000_000):
        self.client, self.prompts, self.max_pdf_bytes = client, prompts, max_pdf_bytes

    def read(self, source: SourceFile, local_path: str, schema: Schema) -> Iterator[CanonicalRecord]:
        mime = source.mime_type.split(";", 1)[0].strip().lower()
        if mime != "application/pdf" and not (
            mime in ("", "application/octet-stream") and source.filename.lower().endswith(".pdf")
        ):
            raise UnsupportedMimeType(f"PDF extraction does not support {mime}")
        path = Path(local_path)
        if path.stat().st_size > self.max_pdf_bytes:
            raise InvalidInput("PDF is too large to send to Gemini inline", "GEMINI_FILE_TOO_LARGE")
        blob = path.read_bytes()
        if not blob:
            raise InvalidInput("This PDF is empty", "EMPTY_FILE")
        if b"%PDF-" not in blob[:1024]:
            raise InvalidInput("File does not have a PDF header", "INVALID_PDF")

        # The pipeline resolves/pins the approved database version before calling us.
        # Include nested field definitions, descriptions, and aliases without changing it.
        prompt = (self.prompts.load("processing/records_from_pdf.txt")
                  .replace("{{SCHEMA}}", schema.model_dump_json(indent=2))
                  .replace("{{FILENAME}}", source.filename))
        parts = [
            {"inline_data": {"mime_type": "application/pdf", "data": base64.b64encode(blob).decode("ascii")}},
            {"text": prompt},
        ]
        records = parse_records(self.client.generate(parts), schema)
        return iter(CanonicalRecord(values=values, source_reference=SourceReference(row_number=number))
                    for number, values in enumerate(records, start=1))
