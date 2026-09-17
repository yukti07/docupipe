from __future__ import annotations

import pandas as pd

from zamp_shared.domain import Schema, SchemaDetectionContext
from zamp_shared.errors import InvalidInput
from .base import SchemaDetector
from .tabular import schema_from_dataframe


class XlsxSchemaDetector(SchemaDetector):
    def __init__(self, sample_rows: int = 20): self.sample_rows = sample_rows

    def detect(self, context: SchemaDetectionContext) -> Schema:
        workbook = pd.ExcelFile(context.local_path)
        usable = [sheet for sheet in workbook.sheet_names if not pd.read_excel(workbook, sheet_name=sheet, nrows=1).empty]
        if not usable: raise InvalidInput("Workbook contains no non-empty sheets")
        selected = usable[0]
        frame = pd.read_excel(workbook, sheet_name=selected, nrows=self.sample_rows)
        return schema_from_dataframe(frame, _stem(context.source_file.filename), {"format": "xlsx", "sheet_name": selected, "meaningful_sheets": usable, "requires_review": len(usable) > 1})


def _stem(filename: str) -> str:
    return filename.rsplit(".", 1)[0] or "records"

