from collections.abc import Iterator

import pandas as pd

from zamp_shared.domain import CanonicalRecord, SourceFile, SourceReference
from .base import SourceReader


class CsvReader(SourceReader):
    def __init__(self, chunk_size: int): self.chunk_size = chunk_size

    def read(self, source: SourceFile, local_path: str) -> Iterator[CanonicalRecord]:
        row_number = 1
        for frame in pd.read_csv(local_path, chunksize=self.chunk_size):
            for _, row in frame.iterrows():
                values = {str(key): None if pd.isna(value) else value.item() if hasattr(value, "item") else value for key, value in row.to_dict().items()}
                yield CanonicalRecord(values=values, source_reference=SourceReference(row_number=row_number))
                row_number += 1

