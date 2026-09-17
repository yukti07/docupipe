from __future__ import annotations

import pandas as pd

from zamp_shared.domain import Schema, SchemaDetectionContext
from .base import SchemaDetector
from .tabular import schema_from_dataframe


class CsvSchemaDetector(SchemaDetector):
    def __init__(self, sample_rows: int = 20): self.sample_rows = sample_rows

    def detect(self, context: SchemaDetectionContext) -> Schema:
        frame = pd.read_csv(context.local_path, nrows=self.sample_rows)
        return schema_from_dataframe(frame, _stem(context.source_file.filename), {"format": "csv", "sample_rows": len(frame)})


def _stem(filename: str) -> str:
    return filename.rsplit(".", 1)[0] or "records"

