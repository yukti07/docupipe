from __future__ import annotations

import pandas as pd

from zamp_shared.domain import DetectedTable, Schema, SchemaDetectionContext
from zamp_shared.errors import InvalidInput
from .base import SchemaDetector
from .tabular import schema_from_dataframe


class XlsxSchemaDetector(SchemaDetector):
    def __init__(self, sample_rows: int = 20): self.sample_rows = sample_rows

    def detect(self, context: SchemaDetectionContext) -> Schema:
        """The first readable sheet, for callers that can only hold one shape.

        `detect_tables` is the real entry point and the pipeline uses it. This
        stays because `SchemaDetector` requires it and the registry's contract
        tests exercise it.
        """
        for table in self.detect_tables(context):
            if table.schema_definition is not None:
                return table.schema_definition
        raise InvalidInput("Workbook contains no non-empty sheets")

    def detect_tables(self, context: SchemaDetectionContext) -> list[DetectedTable]:
        """Every worksheet, in workbook order, at its own index.

        EVERY sheet, not every readable sheet: the ordinal is the sheet's own
        position, so it stays the same however the sheet reads, and a second
        delivery lands on the same `file_schemas` row. A sheet that yields
        nothing carries a failure instead of a shape rather than being dropped,
        which would silently renumber everything after it.
        """
        # Closed rather than left to the collector: the caller reads the
        # workbook inside a temporary directory it then removes, and on Windows
        # a live handle makes that removal fail.
        with pd.ExcelFile(context.local_path) as workbook:
            stem = _stem(context.source_file.filename)
            hidden = _hidden_sheets(workbook)
            return [self._one_sheet(workbook, index, name, name in hidden, stem)
                    for index, name in enumerate(workbook.sheet_names)]

    def _one_sheet(self, workbook: pd.ExcelFile, index: int, name: str, hidden: bool, stem: str) -> DetectedTable:
        table = DetectedTable(ord=index, label=name, hidden=hidden)
        try:
            frame = pd.read_excel(workbook, sheet_name=name, nrows=self.sample_rows)
        except Exception as exc:  # noqa: BLE001
            # One unreadable sheet is not an unreadable workbook (§17).
            return table.model_copy(update={"failure_code": "FORMAT_CORRUPT",
                                            "failure_detail": f"{type(exc).__name__}: {exc}"})

        if frame.columns.empty:
            return table.model_copy(update={"failure_code": "EXTRACT_EMPTY",
                                            "failure_detail": f"The sheet '{name}' has no columns."})

        schema = schema_from_dataframe(frame, stem, {"format": "xlsx", "sheet_name": name,
                                                     "worksheet_index": index, "worksheet_hidden": hidden})
        return table.model_copy(update={"schema_definition": schema})


def _hidden_sheets(workbook: pd.ExcelFile) -> set[str]:
    """Which sheets the workbook hides. Pandas does not carry sheet state, and
    a hidden sheet must not disappear on its own (§18) — the product may choose
    to exclude them later, but that has to be a decision someone made."""
    book = getattr(workbook, "book", None)
    if book is None: return set()
    try:
        return {name for name in workbook.sheet_names if book[name].sheet_state != "visible"}
    except Exception:  # noqa: BLE001
        return set()


def _stem(filename: str) -> str:
    return filename.rsplit(".", 1)[0] or "records"
