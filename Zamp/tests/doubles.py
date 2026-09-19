"""In-memory stand-ins for the database-backed repositories.

Postgres is not reachable from this checkout, and the repositories speak SQL
that only Postgres understands (enum casts, jsonb, ON CONFLICT). These doubles
keep the pipelines under test with real detectors, real readers and real
schemas, and fake only the rows.
"""
from __future__ import annotations

import shutil
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

from zamp_shared.domain import ProcessingRun, RunStatus, Schema, SchemaStatus, SchemaVersion, SourceFile


class _Result:
    def scalar(self): return None
    def first(self): return None
    def scalars(self): return []


class _Session:
    def execute(self, *_args, **_kwargs): return _Result()
    def add(self, _row): return None
    def flush(self): return None


class FakeDatabase:
    @contextmanager
    def session(self):
        yield _Session()


@dataclass
class FakeTable:
    """One `file_schemas` row and the `file_schema_results` row beside it."""
    id: str
    table_ord: int
    table_label: str | None
    fields: list[dict]
    stage: str = "QUEUED"
    row_count: int = 0
    failure: tuple[str, str] | None = None
    version: SchemaVersion | None = None


class FakeFiles:
    def __init__(self, source: SourceFile, *, claimable: bool = True, converted: bool = False):
        self.source, self.claimable, self.converted = source, claimable, converted
        self.database = FakeDatabase()
        self.stage = "UPLOADED"
        self.failure: tuple[str, str] | None = None
        self.detected_content_type: str | None = None
        self.refreshed = 0

    def get(self, _request_id, _file_id) -> SourceFile: return self.source
    def claim(self, *_args, **_kwargs) -> bool: return self.claimable
    def stage_of(self, _file_id) -> str: return self.stage
    def renew(self, *_args, **_kwargs) -> None: return None
    def set_detected_content_type(self, _file_id, detected) -> None: self.detected_content_type = detected
    def refresh_request_status(self, _request_id) -> None: self.refreshed += 1

    def update_stage(self, _file_id, stage, code=None, detail=None) -> None:
        self.stage = stage
        self.failure = (code, detail) if code else None


class FakeSchemas:
    def __init__(self) -> None:
        self.tables: dict[int, FakeTable] = {}
        self.approved: dict[int, SchemaVersion] = {}

    # ---- writes the detector makes

    def persist_table(self, request_id, file_id, table_ord, table_label, fields) -> str:
        existing = self.tables.get(table_ord)
        if existing: return existing.id
        table = FakeTable(id=f"sch_{table_ord}", table_ord=table_ord, table_label=table_label, fields=list(fields))
        self.tables[table_ord] = table
        return table.id

    def persist_detected(self, request_id, file_id, schema: Schema, table_ord=0, table_label=None) -> SchemaVersion:
        fields = [{"key": f.name, "label": f.name, "type": "text", "origin": "detected"} for f in schema.fields]
        schema_id = self.persist_table(request_id, file_id, table_ord, table_label or schema.name, fields)
        table = self.tables[table_ord]
        if table.version is None:
            table.version = SchemaVersion(id=f"ver_{table_ord}", file_schema_id=schema_id, request_id=request_id,
                                          file_id=file_id, version=1, status=SchemaStatus.READY_FOR_REVIEW,
                                          schema=schema, source="DETERMINISTIC")
        return table.version

    def seed_result(self, request_id, file_id, file_schema_id, field_count) -> None:
        for table in self.tables.values():
            if table.id == file_schema_id:
                table.stage, table.failure = "QUEUED", None

    def set_result_stage(self, file_id, stage, *, file_schema_id=None, row_count=None,
                         progress=None, code=None, detail=None) -> None:
        targets = [t for t in self.tables.values() if file_schema_id in (None, t.id)]
        for table in targets:
            table.stage = stage
            if row_count is not None: table.row_count = row_count
            table.failure = (code, detail or "") if stage == "FAILED" else None

    # ---- reads

    def versions_for_file(self, _file_id) -> dict[int, SchemaVersion]:
        return {ord_: table.version for ord_, table in self.tables.items() if table.version}

    def latest_for_file(self, _file_id) -> SchemaVersion | None:
        versions = [t.version for t in self.tables.values() if t.version]
        return versions[0] if versions else None

    def tables_for_file(self, _file_id) -> list[dict]:
        return [{"file_schema_id": t.id, "table_ord": t.table_ord, "table_label": t.table_label,
                 "fields": t.fields, "stage": t.stage}
                for t in sorted(self.tables.values(), key=lambda t: t.table_ord)]

    def snapshot_approved(self, file_id, table_ord=0) -> SchemaVersion:
        from zamp_shared.errors import DomainError
        table = self.tables.get(table_ord)
        if table is None or not table.fields:
            raise DomainError(f"File {file_id} has no detected schema to convert against", "SCHEMA_NOT_FOUND")
        version = self.approved.get(table_ord) or table.version.model_copy(
            update={"id": f"app_{table_ord}", "status": SchemaStatus.APPROVED})
        self.approved[table_ord] = version
        return version

    def get(self, schema_version_id) -> SchemaVersion:
        for table in self.tables.values():
            if table.version and table.version.id == schema_version_id: return table.version
        from zamp_shared.errors import DomainError
        raise DomainError("not found", "SCHEMA_NOT_FOUND")


class FakeRuns:
    def __init__(self) -> None: self.runs: dict[str, ProcessingRun] = {}

    def open_for(self, request_id, file_id, schema_version_id) -> ProcessingRun:
        for run in self.runs.values():
            if run.file_id == file_id and run.file_schema_version_id == schema_version_id: return run
        run = ProcessingRun(id=f"run_{len(self.runs)}", request_id=request_id, file_id=file_id,
                            file_schema_version_id=schema_version_id, status=RunStatus.PENDING)
        self.runs[run.id] = run
        return run

    def find(self, run_id) -> ProcessingRun | None: return self.runs.get(run_id)

    def update(self, run_id, **values) -> ProcessingRun:
        run = self.runs[run_id].model_copy(update={k: v for k, v in values.items() if k in ProcessingRun.model_fields})
        self.runs[run_id] = run
        return run


class FakeStorage:
    """Serves one local file for every download, and remembers what was written."""
    def __init__(self, served: Path | None = None):
        self.served, self.uploaded = served, []

    def download_to_file(self, _bucket, _object_key, destination: Path) -> None:
        Path(destination).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(self.served, destination)

    def upload_file(self, _bucket, object_key, _path) -> None: self.uploaded.append(object_key)


class FakeWriter:
    def __init__(self) -> None: self.records, self.errors = [], []
    def write_record(self, file_id, table_ord, record) -> None: self.records.append((file_id, table_ord, record))
    def write_error(self, error) -> None: self.errors.append(error)


class RecordingEvents:
    def __init__(self) -> None: self.events = []
    def record(self, **kwargs) -> None: self.events.append(kwargs)
    def types(self) -> list[str]: return [event["event_type"] for event in self.events]


class RecordingOutbox:
    def __init__(self) -> None: self.enqueued = []
    def enqueue(self, **kwargs) -> int:
        self.enqueued.append(kwargs)
        return len(self.enqueued)
