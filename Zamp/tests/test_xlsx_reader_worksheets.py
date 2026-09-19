"""The reader reads the worksheet it was told to read, and nothing else."""
from pathlib import Path

import pytest

from zamp_shared.domain import Schema, SchemaField, SourceFile
from zamp_shared.errors import InvalidInput

from test_xlsx_worksheets import workbook

SCHEMA = Schema(name="records", fields=[SchemaField(name="id", type="integer")])


def source(path: Path, **worksheet) -> SourceFile:
    return SourceFile(id="file", request_id="request", user_id="user", bucket="b", object_key="o",
                      filename=path.name,
                      mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                      size_bytes=path.stat().st_size, **worksheet)


def three_sheets(tmp_path: Path) -> Path:
    return workbook(tmp_path / "customers.xlsx", {
        "Customers": [["id", "name"], [1, "Ada"], [2, "Grace"]],
        "Orders": [["order_id", "amount"], [9, 12.5]],
        "Payments": [["payment_id", "status"], [3, "paid"]],
    })


def test_reads_only_the_worksheet_it_was_given(tmp_path: Path, processor) -> None:
    path = three_sheets(tmp_path)

    records = list(processor.XlsxReader(chunk_size=100).read(
        source(path, worksheet_index=1, worksheet_name="Orders"), str(path), SCHEMA))

    assert [record.values for record in records] == [{"order_id": 9, "amount": 12.5}]


def test_the_first_worksheet_is_not_a_fallback(tmp_path: Path, processor) -> None:
    path = three_sheets(tmp_path)

    with pytest.raises(InvalidInput) as raised:
        list(processor.XlsxReader(chunk_size=100).read(source(path), str(path), SCHEMA))

    assert raised.value.code == "XLSX_WORKSHEET_CONTEXT_MISSING"


def test_the_index_decides_when_the_name_disagrees(tmp_path: Path, processor) -> None:
    path = three_sheets(tmp_path)

    records = list(processor.XlsxReader(chunk_size=100).read(
        source(path, worksheet_index=2, worksheet_name="Customers"), str(path), SCHEMA))

    assert [record.values for record in records] == [{"payment_id": 3, "status": "paid"}]


def test_records_carry_their_worksheet_and_row(tmp_path: Path, processor) -> None:
    path = three_sheets(tmp_path)

    records = list(processor.XlsxReader(chunk_size=100).read(
        source(path, worksheet_index=0, worksheet_name="Customers"), str(path), SCHEMA))

    assert [(r.source_reference.sheet_name, r.source_reference.row_number) for r in records] == [
        ("Customers", 1), ("Customers", 2)]


def test_a_worksheet_index_past_the_end_is_refused(tmp_path: Path, processor) -> None:
    path = three_sheets(tmp_path)

    with pytest.raises(InvalidInput) as raised:
        list(processor.XlsxReader(chunk_size=100).read(
            source(path, worksheet_index=7, worksheet_name="Ghost"), str(path), SCHEMA))

    assert raised.value.code == "XLSX_WORKSHEET_NOT_FOUND"
