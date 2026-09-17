"""Drive the local worker flow end to end against a real database.

Two gaps make this necessary. The workers never create their own tables, and schema approval plus
processing-run creation are backend responsibilities with no HTTP endpoint on either worker. So a
fresh `docker compose up` has an empty database, nothing to detect, and no way to reach the processor.

  seed     create tables, insert a request/file row, print the schema-detection envelope
  approve  approve a detected schema version, create the processing run, print the processing envelope

Run `seed`, POST the envelope to the detector, then run `approve` with the schemaVersionId it returned.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python" / "shared" / "src"))

from zamp_shared.domain import ProcessingRun, RunStatus  # noqa: E402
from zamp_shared.pubsub import ProcessingRequest, SchemaDetectionRequest, encode_envelope  # noqa: E402
from zamp_shared.repositories import (  # noqa: E402
    Database, FileRow, ProcessingRepository, RequestRow, SchemaRepository,
)

MIME_TYPES = {
    ".csv": "text/csv",
    ".json": "application/json",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def emit(title: str, port: int, envelope: dict) -> None:
    body = json.dumps(envelope)
    print(f"\n{title}\n")
    print(f"  curl -s -X POST http://localhost:{port}/ -H 'Content-Type: application/json' -d '{body}'\n")
    print("PowerShell:\n")
    print(f"  Invoke-RestMethod -Uri http://localhost:{port}/ -Method Post "
          f"-ContentType application/json -Body '{body}'\n")


def seed(database: Database, args: argparse.Namespace) -> None:
    filename = args.object_key.rsplit("/", 1)[-1]
    mime_type = args.mime_type or MIME_TYPES.get(Path(filename).suffix.lower())
    if not mime_type:
        raise SystemExit(f"cannot infer a MIME type from {filename!r}; pass --mime-type")

    database.create_all_for_local_test()
    with database.session() as session:
        if not session.get(RequestRow, args.request_id):
            session.add(RequestRow(id=args.request_id, user_id=args.user_id, status="COLLECTING"))
        row = session.get(FileRow, args.file_id)
        if row:
            row.bucket, row.object_key, row.original_filename = args.bucket, args.object_key, filename
            row.content_type = row.detected_content_type = mime_type
            row.size_bytes, row.stage = args.size_bytes, "UPLOADED"
        else:
            session.add(FileRow(
                id=args.file_id, request_id=args.request_id, user_id=args.user_id,
                original_filename=filename, content_type=mime_type, detected_content_type=mime_type,
                size_bytes=args.size_bytes, bucket=args.bucket, object_key=args.object_key, stage="UPLOADED",
            ))

    print(f"tables created; file {args.file_id} -> gs://{args.bucket}/{args.object_key} ({mime_type})")
    emit("1. Detect the schema (returns schemaVersionId):", args.detector_port,
         encode_envelope(SchemaDetectionRequest(
             eventType="SCHEMA_DETECTION_REQUESTED", requestId=args.request_id, fileId=args.file_id)))
    print("2. Then: py -3.12 scripts/local_bootstrap.py approve --schema-version-id <id>")


def approve(database: Database, args: argparse.Namespace) -> None:
    schemas, runs = SchemaRepository(database), ProcessingRepository(database)
    approved = schemas.approve(args.schema_version_id)
    print(f"approved {args.schema_version_id} -> version {approved.version} ({approved.id})")

    try:
        runs.get(args.run_id)
        print(f"processing run {args.run_id} already exists; reusing it")
    except Exception:
        runs.create(ProcessingRun(
            id=args.run_id, request_id=approved.request_id, file_id=approved.file_id,
            file_schema_version_id=approved.id, status=RunStatus.PENDING))
        print(f"created processing run {args.run_id}")

    emit("3. Process the file:", args.processor_port,
         encode_envelope(ProcessingRequest(
             eventType="PROCESSING_REQUESTED", requestId=approved.request_id, fileId=approved.file_id,
             processingRunId=args.run_id, fileSchemaVersionId=approved.id)))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--database-url", default=os.getenv("ZAMP_DATABASE_URL"),
                        help="defaults to $ZAMP_DATABASE_URL; from the host use localhost, not the 'postgres' service name")
    subparsers = parser.add_subparsers(dest="command", required=True)

    s = subparsers.add_parser("seed", help="create tables and insert a request/file row")
    s.add_argument("--bucket", required=True, help="GCS bucket holding the uploaded object")
    s.add_argument("--object-key", required=True, help="e.g. uploads/request_local/input/customers.csv")
    s.add_argument("--request-id", default="request_local")
    s.add_argument("--file-id", default="file_local")
    s.add_argument("--user-id", default="user_local")
    s.add_argument("--mime-type", default=None, help="defaults to the object key's extension")
    s.add_argument("--size-bytes", type=int, default=0, help="only needs to be non-null; no worker reads the value")
    s.add_argument("--detector-port", type=int, default=8080)
    s.set_defaults(handler=seed)

    a = subparsers.add_parser("approve", help="approve a schema version and create the processing run")
    a.add_argument("--schema-version-id", required=True, help="the schemaVersionId the detector returned")
    a.add_argument("--run-id", default="run_local")
    a.add_argument("--processor-port", type=int, default=8081)
    a.set_defaults(handler=approve)

    args = parser.parse_args()
    if not args.database_url:
        parser.error("--database-url is required (or set ZAMP_DATABASE_URL)")
    args.handler(Database(args.database_url), args)


if __name__ == "__main__":
    main()
