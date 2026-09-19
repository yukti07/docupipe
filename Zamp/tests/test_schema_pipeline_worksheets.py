"""Detection over a workbook: one table per worksheet, each settling alone."""
from pathlib import Path

import pytest

from zamp_shared.domain import SourceFile

from doubles import FakeFiles, FakeSchemas, FakeStorage, RecordingEvents, RecordingOutbox
from test_xlsx_worksheets import workbook

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def build(served: Path):
    from app.detectors.xlsx import XlsxSchemaDetector
    from app.pipeline.detector_registry import DetectorRegistry
    from app.pipeline.schema_pipeline import SchemaPipeline
    from app.services.schema_validator import SchemaValidator
    from doubles import FakeDatabase

    source = SourceFile(id="F100", request_id="R123", user_id="U1", bucket="b",
                        object_key="requests/R123/input/F100/bank_statement.xlsx",
                        filename=served.name, mime_type=XLSX, size_bytes=served.stat().st_size)
    files, schemas, storage = FakeFiles(source), FakeSchemas(), FakeStorage(served)
    pipeline = SchemaPipeline(files, schemas, storage,
                              DetectorRegistry({XLSX: XlsxSchemaDetector()}), SchemaValidator(),
                              database=FakeDatabase(), instance_id="i1", lease_seconds=60,
                              topic_convert_requested="convert")
    pipeline.events, pipeline.outbox = RecordingEvents(), RecordingOutbox()
    return pipeline, files, schemas, storage


def bank_statement(tmp_path: Path) -> Path:
    return workbook(tmp_path / "bank_statement.xlsx", {
        "Transactions": [["date", "description", "amount"], ["2026-01-02", "Coffee", -3.5]],
        "Account Summary": [["account", "balance"], ["NL01", 1200.0]],
        "Metadata": [["key", "value"], ["exported_by", "core"]],
    })


def test_every_worksheet_becomes_a_table_of_its_own(tmp_path: Path) -> None:
    pipeline, files, schemas, _ = build(bank_statement(tmp_path))

    pipeline.execute("R123", "F100")

    assert [(t["table_ord"], t["table_label"]) for t in schemas.tables_for_file("F100")] == [
        (0, "Transactions"), (1, "Account Summary"), (2, "Metadata")]
    assert files.stage == "SCHEMA_READY"


def test_each_worksheet_keeps_its_own_fields(tmp_path: Path) -> None:
    pipeline, _, schemas, _ = build(bank_statement(tmp_path))

    pipeline.execute("R123", "F100")

    assert [[f["key"] for f in t["fields"]] for t in schemas.tables_for_file("F100")] == [
        ["date", "description", "amount"], ["account", "balance"], ["key", "value"]]


def test_every_table_is_queued_for_conversion(tmp_path: Path) -> None:
    pipeline, _, schemas, _ = build(bank_statement(tmp_path))

    pipeline.execute("R123", "F100")

    assert [t["stage"] for t in schemas.tables_for_file("F100")] == ["QUEUED"] * 3


def test_one_unreadable_worksheet_does_not_take_the_others_down(tmp_path: Path) -> None:
    served = workbook(tmp_path / "bank_statement.xlsx", {
        "Transactions": [["date", "amount"], ["2026-01-02", -3.5]],
        "Blank": [],
        "Metadata": [["key", "value"], ["exported_by", "core"]],
    })
    pipeline, files, schemas, _ = build(served)

    pipeline.execute("R123", "F100")

    tables = schemas.tables_for_file("F100")
    assert [t["stage"] for t in tables] == ["QUEUED", "FAILED", "QUEUED"]
    assert tables[1]["table_label"] == "Blank"
    # The file itself is readable; only one of its tables was not.
    assert files.stage == "SCHEMA_READY"
    assert files.failure is None


def test_a_workbook_whose_every_sheet_is_empty_fails_the_file(tmp_path: Path) -> None:
    from zamp_shared.errors import DomainError

    served = workbook(tmp_path / "bank_statement.xlsx", {"Blank": [], "Also blank": []})
    pipeline, files, _, _ = build(served)

    with pytest.raises(DomainError):
        pipeline.execute("R123", "F100")

    assert files.stage == "FAILED"
    assert files.failure[0] == "EXTRACT_EMPTY"


def test_a_second_delivery_lands_on_the_same_tables(tmp_path: Path) -> None:
    pipeline, files, schemas, _ = build(bank_statement(tmp_path))

    pipeline.execute("R123", "F100")
    before = [(t["file_schema_id"], t["table_ord"]) for t in schemas.tables_for_file("F100")]
    files.stage = "UPLOADED"
    pipeline.execute("R123", "F100")

    assert [(t["file_schema_id"], t["table_ord"]) for t in schemas.tables_for_file("F100")] == before


def test_each_table_gets_its_own_schema_artifact(tmp_path: Path) -> None:
    pipeline, _, _, storage = build(bank_statement(tmp_path))

    pipeline.execute("R123", "F100")

    assert len(storage.uploaded) == 3
    assert len(set(storage.uploaded)) == 3
