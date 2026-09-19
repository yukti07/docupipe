from collections.abc import Iterator

import pandas as pd

from zamp_shared.domain import CanonicalRecord, Schema, SourceFile, SourceReference
from zamp_shared.errors import InvalidInput
from .base import SourceReader


class XlsxReader(SourceReader):
    def __init__(self, chunk_size: int): self.chunk_size = chunk_size

    def read(self, source: SourceFile, local_path: str, schema: Schema) -> Iterator[CanonicalRecord]:
        """The one worksheet this logical table stands for.

        There is deliberately no fallback to the first sheet. A workbook is
        several tables sharing one object, so "the first readable sheet" is a
        guess that reads the wrong rows under the right table's name — silently,
        and only for multi-sheet files. Being told which sheet is the caller's
        job; not being told is an error.
        """
        if source.worksheet_index is None:
            raise InvalidInput("This spreadsheet table does not say which worksheet it came from.",
                               "XLSX_WORKSHEET_CONTEXT_MISSING")

        with pd.ExcelFile(local_path) as workbook:
            if source.worksheet_index >= len(workbook.sheet_names):
                raise InvalidInput(
                    f"This workbook has no worksheet {source.worksheet_index + 1}.",
                    "XLSX_WORKSHEET_NOT_FOUND")

            # By position, not by name: names are edited, duplicated across
            # workbooks and carry characters that nothing else round-trips,
            # which is why the index is what the table row stores.
            sheet = workbook.sheet_names[source.worksheet_index]
            frame = pd.read_excel(workbook, sheet_name=sheet)

        for index, row in frame.iterrows():
            values = {str(key): None if pd.isna(value) else value.item() if hasattr(value, "item") else value
                      for key, value in row.to_dict().items()}
            yield CanonicalRecord(values=values,
                                  source_reference=SourceReference(row_number=int(index) + 1, sheet_name=sheet))
