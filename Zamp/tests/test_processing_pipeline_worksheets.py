"""Conversion over a workbook: one run per worksheet, each settling alone."""
from pathlib import Path

import pytest

from zamp_shared.domain import RunStatus, Schema, SchemaField, SchemaStatus, SchemaVersion, SourceFile

from doubles import FakeDatabase, FakeFiles, FakeRuns, FakeSchemas, FakeStorage, FakeTable, FakeWriter, RecordingEvents
from test_xlsx_worksheets import workbook

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

#: The shapes detection writes for the workbook below, seeded directly. The
#: detector runs in the other worker's package, which the `processor` fixture
#: swaps out, and conversion should not need it to be present anyway.
SHEETS = [
    (0, "Transactions", [("date", "string"), ("amount", "number")]),
    (1, "Account Summary", [("account", "string"), ("balance", "number")]),
    (2, "Metadata", [("key", "string"), ("value", "string")]),
]


def bank_statement(tmp_path: Path) -> Path:
    return workbook(tmp_path / "bank_statement.xlsx", {
        "Transactions": [["date", "amount"], ["2026-01-02", -3.5], ["2026-01-03", -8.0]],
        "Account Summary": [["account", "balance"], ["NL01", 1200.0]],
        "Metadata": [["key", "value"], ["exported_by", "core"]],
    })


def seeded_schemas(file_id: str = "F100", request_id: str = "R123") -> FakeSchemas:
    schemas = FakeSchemas()
    for table_ord, label, fields in SHEETS:
        schema = Schema(name="bank_statement",
                        fields=[SchemaField(name=name, type=type_) for name, type_ in fields],
                        metadata={"format": "xlsx", "sheet_name": label, "worksheet_index": table_ord})
        schemas.tables[table_ord] = FakeTable(
            id=f"sch_{table_ord}", table_ord=table_ord, table_label=label,
            fields=[{"key": name, "label": name, "type": "text", "origin": "detected"} for name, _ in fields],
            version=SchemaVersion(id=f"ver_{table_ord}", file_schema_id=f"sch_{table_ord}",
                                  request_id=request_id, file_id=file_id, version=1,
                                  status=SchemaStatus.READY_FOR_REVIEW, schema=schema, source="DETERMINISTIC"))
    return schemas


def build(served: Path, processor, max_records: int = 1000):
    from app.transformation.coercion import TypeCoercer
    from app.transformation.mapper import SchemaMapper

    source = SourceFile(id="F100", request_id="R123", user_id="U1", bucket="b",
                        object_key="requests/R123/input/F100/bank_statement.xlsx",
                        filename=served.name, mime_type=XLSX, size_bytes=served.stat().st_size)
    files = FakeFiles(source)
    files.stage = "CONVERTING"
    schemas, runs, writer = seeded_schemas(), FakeRuns(), FakeWriter()

    pipeline = processor.ProcessingPipeline(
        files, schemas, runs, FakeStorage(served),
        processor.ProcessorRegistry({XLSX: processor.XlsxReader(chunk_size=100)}),
        SchemaMapper(), TypeCoercer(), processor.DeterministicValidator(), writer, max_records,
        database=FakeDatabase(), instance_id="i1", lease_seconds=60)
    pipeline.events = RecordingEvents()
    return pipeline, files, schemas, runs, writer


def test_each_worksheet_is_converted_in_its_own_run(tmp_path: Path, processor) -> None:
    pipeline, _, _, runs, _ = build(bank_statement(tmp_path), processor)

    pipeline.execute("R123", "F100")

    assert len(runs.runs) == 3
    assert {run.status for run in runs.runs.values()} == {RunStatus.COMPLETED}
    # Three runs against three different shapes, not three against one.
    assert len({run.file_schema_version_id for run in runs.runs.values()}) == 3


def test_every_worksheet_contributes_its_own_rows(tmp_path: Path, processor) -> None:
    pipeline, _, _, _, writer = build(bank_statement(tmp_path), processor)

    pipeline.execute("R123", "F100")

    written = [record.data for _file_id, _ord, record in writer.records]
    assert {"date": "2026-01-02", "amount": -3.5} in written
    assert {"account": "NL01", "balance": 1200.0} in written
    assert {"key": "exported_by", "value": "core"} in written


def test_no_worksheet_reads_another_worksheets_rows(tmp_path: Path, processor) -> None:
    pipeline, _, _, runs, writer = build(bank_statement(tmp_path), processor)

    pipeline.execute("R123", "F100")

    by_run: dict[str, list[dict]] = {}
    for _file_id, _ord, record in writer.records:
        by_run.setdefault(record.processing_run_id, []).append(record.data)

    shapes = sorted(sorted(next(iter(rows)).keys()) for rows in by_run.values())
    assert shapes == [["account", "balance"], ["amount", "date"], ["key", "value"]]


def test_each_table_reports_its_own_row_count(tmp_path: Path, processor) -> None:
    pipeline, _, schemas, _, _ = build(bank_statement(tmp_path), processor)

    pipeline.execute("R123", "F100")

    assert [(t["table_label"], t["stage"]) for t in schemas.tables_for_file("F100")] == [
        ("Transactions", "DONE"), ("Account Summary", "DONE"), ("Metadata", "DONE")]
    assert [schemas.tables[i].row_count for i in (0, 1, 2)] == [2, 1, 1]


def test_the_file_completes_when_all_its_tables_do(tmp_path: Path, processor) -> None:
    pipeline, files, _, _, _ = build(bank_statement(tmp_path), processor)

    pipeline.execute("R123", "F100")

    assert files.stage == "COMPLETED"


def test_one_failing_worksheet_leaves_the_others_converted(tmp_path: Path, processor) -> None:
    pipeline, files, schemas, _, writer = build(bank_statement(tmp_path), processor)

    # The middle table has no approved shape by the time conversion reaches it.
    schemas.tables[1].fields = []

    pipeline.execute("R123", "F100")

    assert [t["stage"] for t in schemas.tables_for_file("F100")] == ["DONE", "FAILED", "DONE"]
    assert files.stage == "COMPLETED"
    assert files.failure is None
    # The sheets either side still wrote their rows.
    assert len(writer.records) == 3


def test_a_file_whose_every_table_fails_is_failed(tmp_path: Path, processor) -> None:
    from zamp_shared.errors import DomainError

    pipeline, files, schemas, _, _ = build(bank_statement(tmp_path), processor)
    for table in schemas.tables.values():
        table.fields = []

    with pytest.raises(DomainError):
        pipeline.execute("R123", "F100")

    assert files.stage == "FAILED"
    assert files.failure[0] == "SCHEMA_NOT_FOUND"


def test_a_second_delivery_does_not_write_the_rows_twice(tmp_path: Path, processor) -> None:
    pipeline, files, _, runs, writer = build(bank_statement(tmp_path), processor)

    pipeline.execute("R123", "F100")
    written = len(writer.records)
    files.stage = "CONVERTING"
    pipeline.execute("R123", "F100")

    assert len(runs.runs) == 3
    assert len(writer.records) == written
