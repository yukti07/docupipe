from pathlib import Path

import pytest

from zamp_shared.config import Settings
from zamp_shared.domain import Schema, SchemaField
from zamp_shared.pubsub import ProcessingRequest, decode_envelope, encode_envelope


def test_pubsub_round_trip() -> None:
    request = ProcessingRequest(eventType="PROCESSING_REQUESTED", requestId="request", fileId="file", processingRunId="run", fileSchemaVersionId="schema")
    assert decode_envelope(encode_envelope(request), ProcessingRequest) == request


def test_schema_rejects_duplicate_names() -> None:
    with pytest.raises(ValueError, match="unique"):
        Schema(name="customers", fields=[SchemaField(name="id", type="string"), SchemaField(name="ID", type="string")])


def test_environment_override_wins_over_yaml(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    config = tmp_path / "config.yaml"
    config.write_text("processing:\n  csv_chunk_size: 20\n")
    monkeypatch.setenv("ZAMP_PROCESSING_CSV_CHUNK_SIZE", "7")
    assert Settings(config).processing.csv_chunk_size == 7
