"""Run the P0 schema-detection + approved-schema processing flow against one local file.

This intentionally uses FakeObjectStorage and a temporary SQLite database. It proves the
application pipeline without uploading customer data to GCS or needing Docker to be running.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python" / "shared" / "src"))

from zamp_shared.domain import ProcessingRun, RunStatus, SourceFile
from zamp_shared.repositories import (  # noqa: E402
    Database, ErrorRepository, FileRepository, FileRow, ProcessingRepository, RecordRepository,
    RequestRow, SchemaRepository, StructuredRecordRow,
)
from zamp_shared.storage import FakeObjectStorage  # noqa: E402

MIME_TYPES = {
    ".csv": "text/csv",
    ".json": "application/json",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def load_schema_worker():
    sys.path.insert(0, str(ROOT / "python" / "schema-detector" / "src"))
    from app.detectors.csv import CsvSchemaDetector
    from app.detectors.json import JsonSchemaDetector
    from app.detectors.xlsx import XlsxSchemaDetector
    from app.pipeline.detector_registry import DetectorRegistry
    from app.pipeline.schema_pipeline import SchemaPipeline
    from app.services.schema_validator import SchemaValidator
    return CsvSchemaDetector, JsonSchemaDetector, XlsxSchemaDetector, DetectorRegistry, SchemaPipeline, SchemaValidator


def unload_worker() -> None:
    for name in list(sys.modules):
        if name == "app" or name.startswith("app."):
            del sys.modules[name]
    sys.path[:] = [entry for entry in sys.path if entry not in {
        str(ROOT / "python" / "schema-detector" / "src"), str(ROOT / "python" / "data-processor" / "src"),
    }]


def load_processor_worker():
    sys.path.insert(0, str(ROOT / "python" / "data-processor" / "src"))
    from app.persistence.record_writer import RecordWriter
    from app.pipeline.processing_pipeline import ProcessingPipeline
    from app.pipeline.processor_registry import ProcessorRegistry
    from app.readers.csv import CsvReader
    from app.readers.json import JsonReader
    from app.readers.xlsx import XlsxReader
    from app.transformation.coercion import TypeCoercer
    from app.transformation.mapper import SchemaMapper
    from app.validation.deterministic import DeterministicValidator
    return RecordWriter, ProcessingPipeline, ProcessorRegistry, CsvReader, JsonReader, XlsxReader, TypeCoercer, SchemaMapper, DeterministicValidator


def main() -> None:
    parser = argparse.ArgumentParser(description="Exercise both P0 workers using a local CSV, JSON, or XLSX file.")
    parser.add_argument("file", type=Path)
    parser.add_argument("--chunk-size", type=int, default=1000)
    args = parser.parse_args()
    source_path = args.file.resolve()
    if not source_path.is_file(): parser.error(f"File does not exist: {source_path}")
    try: mime_type = MIME_TYPES[source_path.suffix.lower()]
    except KeyError: parser.error("Only .csv, .json, and .xlsx are supported by the P0 smoke test")

    job_id, file_id, run_id = "local-job", "local-file", "local-run"
    storage = FakeObjectStorage()
    storage.objects[("local-test", f"uploads/{file_id}/input/{source_path.name}")] = source_path.read_bytes()

    with tempfile.TemporaryDirectory(prefix="zamp-smoke-") as directory:
        database = Database(f"sqlite+pysqlite:///{(Path(directory) / 'zamp.db').as_posix()}")
        database.create_all_for_local_test()
        files, schemas, runs = FileRepository(database), SchemaRepository(database), ProcessingRepository(database)
        with database.session() as session:
            session.add(RequestRow(id=job_id, user_id="local-user", status="COLLECTING"))
            session.add(FileRow(id=file_id, request_id=job_id, user_id="local-user", original_filename=source_path.name, content_type=mime_type, detected_content_type=mime_type, size_bytes=source_path.stat().st_size, bucket="local-test", object_key=f"uploads/{file_id}/input/{source_path.name}", stage="UPLOADED"))

        CsvSchemaDetector, JsonSchemaDetector, XlsxSchemaDetector, DetectorRegistry, SchemaPipeline, SchemaValidator = load_schema_worker()
        detector = SchemaPipeline(files, schemas, storage, DetectorRegistry({
            "text/csv": CsvSchemaDetector(), "application/json": JsonSchemaDetector(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": XlsxSchemaDetector(),
        }), SchemaValidator())
        candidate = detector.execute(job_id, file_id)
        approved = schemas.approve(candidate.id)
        unload_worker()

        runs.create(ProcessingRun(id=run_id, request_id=job_id, file_id=file_id, file_schema_version_id=approved.id, status=RunStatus.PENDING))
        RecordWriter, ProcessingPipeline, ProcessorRegistry, CsvReader, JsonReader, XlsxReader, TypeCoercer, SchemaMapper, DeterministicValidator = load_processor_worker()
        processor = ProcessingPipeline(files, schemas, runs, storage, ProcessorRegistry({
            "text/csv": CsvReader(args.chunk_size), "application/json": JsonReader(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": XlsxReader(args.chunk_size),
        }), SchemaMapper(), TypeCoercer(), DeterministicValidator(), RecordWriter(RecordRepository(database), ErrorRepository(database)), max_records=100_000)
        result = processor.execute(job_id, file_id, run_id, approved.id)
        with database.session() as session:
            persisted = session.query(StructuredRecordRow).order_by(StructuredRecordRow.record_number).limit(3).all()
        print(json.dumps({
            "status": "passed",
            "candidate_schema": candidate.schema_definition.model_dump(mode="json"),
            "approved_schema_version_id": approved.id,
            "processing": result.model_dump(),
            "first_persisted_records": [row.data for row in persisted],
        }, default=str, indent=2))


if __name__ == "__main__":
    main()
