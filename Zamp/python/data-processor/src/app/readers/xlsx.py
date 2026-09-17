from collections.abc import Iterator

import pandas as pd

from zamp_shared.domain import CanonicalRecord, SourceFile, SourceReference
from .base import SourceReader


class XlsxReader(SourceReader):
    def __init__(self, chunk_size: int): self.chunk_size = chunk_size

    def read(self, source: SourceFile, local_path: str) -> Iterator[CanonicalRecord]:
        sheet = None
        # Detector persists the chosen sheet in schema metadata; for P0 first meaningful sheet is deterministic.
        workbook = pd.ExcelFile(local_path)
        for candidate in workbook.sheet_names:
            if not pd.read_excel(workbook, sheet_name=candidate, nrows=1).empty:
                sheet = candidate; break
        if sheet is None: return
        frame = pd.read_excel(workbook, sheet_name=sheet)
        for index, row in frame.iterrows():
            values = {str(key): None if pd.isna(value) else value.item() if hasattr(value, "item") else value for key, value in row.to_dict().items()}
            yield CanonicalRecord(values=values, source_reference=SourceReference(row_number=int(index) + 1, sheet_name=sheet))

