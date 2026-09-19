from zamp_shared.domain import RecordError, StructuredRecord
from zamp_shared.repositories import ErrorRepository, RecordRepository


class RecordWriter:
    def __init__(self, records: RecordRepository, errors: ErrorRepository): self.records, self.errors = records, errors
    def write_record(self, file_id: str, table_ord: int, record: StructuredRecord) -> None:
        self.records.write(file_id, table_ord, record)
    def write_error(self, error: RecordError) -> None: self.errors.write(error)

