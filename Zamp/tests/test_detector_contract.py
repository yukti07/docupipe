"""Run with PYTHONPATH including shared and schema-detector source."""
from pathlib import Path

import pandas as pd

from zamp_shared.domain import SchemaDetectionContext, SourceFile


def test_csv_detector_infers_types(tmp_path: Path) -> None:
    from app.detectors.csv import CsvSchemaDetector

    source = tmp_path / "customers.csv"
    source.write_text("id,name,active\n1,Ada,true\n2,Grace,false\n", encoding="utf-8")
    schema = CsvSchemaDetector().detect(SchemaDetectionContext(source_file=SourceFile(id="file", request_id="request", user_id="user", bucket="b", object_key="o", filename=source.name, mime_type="text/csv", size_bytes=source.stat().st_size), local_path=str(source)))
    assert [(field.name, field.type, field.required) for field in schema.fields] == [("id", "integer", True), ("name", "string", True), ("active", "boolean", True)]


def test_detector_registry_normalizes_mime_parameters_and_extension() -> None:
    from app.detectors.csv import CsvSchemaDetector
    from app.pipeline.detector_registry import DetectorRegistry

    registry = DetectorRegistry({"text/csv": CsvSchemaDetector()})
    detector = registry.resolve("text/csv; charset=utf-8", "customers.csv")
    assert isinstance(detector, CsvSchemaDetector)
    assert registry.resolve("application/octet-stream", "customers.csv") is detector


def test_gemini_parser_extracts_json_from_prose_and_markdown() -> None:
    from app.detectors.gemini import GeminiSchemaDetector

    raw = 'Here is the schema:\n```json\n{"name":"records","fields":[{"name":"id","type":"integer","required":true,"description":null,"aliases":[],"fields":[],"item_type":null,"item_fields":[]}],"metadata":{"format":"unknown"}}\n```'
    payload = GeminiSchemaDetector._parse_json(raw)
    assert payload["fields"][0]["name"] == "id"


def test_gemini_parser_rejects_response_without_schema() -> None:
    from app.detectors.gemini import GeminiSchemaDetector
    import pytest

    with pytest.raises(Exception):
        GeminiSchemaDetector._parse_json("No JSON schema was found.")
