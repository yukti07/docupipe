"""Every worksheet in a workbook is its own table.

The workbook stays one physical object and one `files` row; the worksheets
become `file_schemas` rows at `table_ord` = the sheet's own index.
"""
from pathlib import Path

import openpyxl
import pytest

from zamp_shared.domain import SchemaDetectionContext, SourceFile


def workbook(path: Path, sheets: dict[str, list[list]], hidden: tuple[str, ...] = ()) -> Path:
    book = openpyxl.Workbook()
    book.remove(book.active)
    for name, rows in sheets.items():
        sheet = book.create_sheet(title=name)
        for row in rows:
            sheet.append(row)
        if name in hidden:
            sheet.sheet_state = "hidden"
    book.save(path)
    return path


def context(path: Path) -> SchemaDetectionContext:
    return SchemaDetectionContext(
        source_file=SourceFile(id="file", request_id="request", user_id="user", bucket="b",
                               object_key="o", filename=path.name,
                               mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                               size_bytes=path.stat().st_size),
        local_path=str(path))


def test_every_worksheet_becomes_its_own_table(tmp_path: Path) -> None:
    from app.detectors.xlsx import XlsxSchemaDetector

    path = workbook(tmp_path / "customers.xlsx", {
        "Customers": [["id", "name", "email"], [1, "Ada", "ada@example.com"]],
        "Orders": [["order_id", "customer_id", "amount"], [9, 1, 12.5]],
        "Payments": [["payment_id", "order_id", "status"], [3, 9, "paid"]],
    })

    tables = XlsxSchemaDetector().detect_tables(context(path))

    assert [(table.ord, table.label) for table in tables] == [
        (0, "Customers"), (1, "Orders"), (2, "Payments")]


def test_each_worksheet_gets_its_own_schema(tmp_path: Path) -> None:
    from app.detectors.xlsx import XlsxSchemaDetector

    path = workbook(tmp_path / "customers.xlsx", {
        "Customers": [["id", "name", "email"], [1, "Ada", "ada@example.com"]],
        "Orders": [["order_id", "customer_id", "amount"], [9, 1, 12.5]],
    })

    tables = XlsxSchemaDetector().detect_tables(context(path))

    assert [f.name for f in tables[0].schema_definition.fields] == ["id", "name", "email"]
    assert [f.name for f in tables[1].schema_definition.fields] == ["order_id", "customer_id", "amount"]


def test_an_empty_worksheet_is_reported_rather_than_skipped(tmp_path: Path) -> None:
    from app.detectors.xlsx import XlsxSchemaDetector

    path = workbook(tmp_path / "customers.xlsx", {
        "Customers": [["id", "name"], [1, "Ada"]],
        "Blank": [],
        "Orders": [["order_id", "amount"], [9, 12.5]],
    })

    tables = XlsxSchemaDetector().detect_tables(context(path))

    assert [table.ord for table in tables] == [0, 1, 2]
    assert tables[1].schema_definition is None
    assert tables[1].failure_code == "EXTRACT_EMPTY"
    # The sheets either side of the empty one are still read.
    assert tables[0].schema_definition is not None and tables[2].schema_definition is not None


def test_a_header_only_worksheet_still_yields_its_shape(tmp_path: Path) -> None:
    from app.detectors.xlsx import XlsxSchemaDetector

    path = workbook(tmp_path / "customers.xlsx", {"Customers": [["id", "name", "email"]]})

    tables = XlsxSchemaDetector().detect_tables(context(path))

    assert [f.name for f in tables[0].schema_definition.fields] == ["id", "name", "email"]
    assert tables[0].failure_code is None


def test_a_hidden_worksheet_is_kept_and_marked_hidden(tmp_path: Path) -> None:
    from app.detectors.xlsx import XlsxSchemaDetector

    path = workbook(tmp_path / "customers.xlsx", {
        "Customers": [["id", "name"], [1, "Ada"]],
        "Workings": [["a", "b"], [1, 2]],
    }, hidden=("Workings",))

    tables = XlsxSchemaDetector().detect_tables(context(path))

    assert [(table.label, table.hidden) for table in tables] == [("Customers", False), ("Workings", True)]
    assert tables[1].schema_definition.metadata["worksheet_hidden"] is True


def test_worksheet_names_with_punctuation_and_unicode_survive(tmp_path: Path) -> None:
    from app.detectors.xlsx import XlsxSchemaDetector

    names = ["Q1 & Q2 (draft)", "Ventes_Détaillées", "客户-2026", "O'Brien's list."]
    path = workbook(tmp_path / "customers.xlsx", {name: [["id"], [1]] for name in names})

    tables = XlsxSchemaDetector().detect_tables(context(path))

    assert [table.label for table in tables] == names
    assert [table.ord for table in tables] == [0, 1, 2, 3]
