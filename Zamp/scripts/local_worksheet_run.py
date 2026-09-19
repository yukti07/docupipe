"""Run both pipelines locally over one workbook, against the real database.

Why this exists: `scripts/smoke_test.py` is broken and assumes SQLite, and the
lease statement in `FileRepository.claim` is PostgreSQL-only, so the durable
path cannot be exercised by the unit tests. This drives the real detector, the
real reader and the real repositories against Cloud SQL through the Auth Proxy,
and prints what actually landed in the tables.

It creates its own request and file rows, and copies the workbook to a GCS key
of its own, so it never touches anything already in the batch.

    python scripts/local_worksheet_run.py <path-to.xlsx> [--keep]
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python" / "shared" / "src"))

PROJECT_ID = "project-cf6fd144-baf2-463b-9cd"
INSTANCE = f"{PROJECT_ID}:us-central1:free-trial-first-project"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
DETECTOR_SRC = ROOT / "python" / "schema-detector" / "src"
PROCESSOR_SRC = ROOT / "python" / "data-processor" / "src"


def gcloud_command(*args: str) -> list[str]:
    if os.name == "nt":
        gcloud = shutil.which("gcloud.cmd") or "gcloud.cmd"
        quote = lambda value: "'" + value.replace("'", "''") + "'"  # noqa: E731
        return ["powershell.exe", "-NoProfile", "-Command",
                "& " + quote(gcloud) + " " + " ".join(quote(arg) for arg in args)]
    return ["gcloud", *args]


def database_url(port: int) -> str:
    value = os.getenv("ZAMP_DATABASE_URL")
    if not value:
        value = subprocess.run(
            gcloud_command("secrets", "versions", "access", "latest",
                           "--secret=zamp-database-url", f"--project={PROJECT_ID}"),
            check=True, capture_output=True, text=True).stdout.strip()

    parsed = urlsplit(value)
    query = parse_qs(parsed.query)
    query.pop("host", None)
    text = "&".join(f"{k}={v}" for k, values in query.items() for v in values)
    return urlunsplit((parsed.scheme, parsed.netloc, f"/{parsed.path.lstrip('/')}", text,
                       parsed.fragment)).replace("@/", f"@127.0.0.1:{port}/", 1)


def swap_to(source: Path) -> None:
    """Both workers root their code at `app`, so only one can own the name."""
    for name in [n for n in list(sys.modules) if n == "app" or n.startswith("app.")]:
        del sys.modules[name]
    for path in (str(DETECTOR_SRC), str(PROCESSOR_SRC)):
        if path in sys.path:
            sys.path.remove(path)
    sys.path.insert(0, str(source))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook")
    parser.add_argument("--port", type=int, default=5433)
    parser.add_argument("--keep", action="store_true", help="leave the rows behind")
    parser.add_argument("--user", help="own the batch as this user, so a browser session can open it")
    args = parser.parse_args()

    book = Path(args.workbook)
    if not book.exists():
        raise SystemExit(f"No such file: {book}")

    proxy_binary = Path(os.environ.get("TEMP", ".")) / "cloud-sql-proxy.exe"
    if not proxy_binary.exists():
        raise SystemExit(f"Cloud SQL proxy not found at {proxy_binary}")

    proxy = subprocess.Popen([str(proxy_binary), f"--port={args.port}", INSTANCE],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        run(book, database_url(args.port), keep=args.keep, user=args.user)
    finally:
        proxy.terminate()
        proxy.wait(timeout=20)


def run(book: Path, url: str, *, keep: bool, user: str | None = None) -> None:
    from sqlalchemy import text
    from zamp_shared.repositories import Database

    database = Database(url)
    for attempt in range(20):
        try:
            with database.session() as session:
                session.execute(text("SELECT 1"))
            break
        except Exception:  # noqa: BLE001
            if attempt == 19:
                raise
            time.sleep(1)

    suffix = uuid.uuid4().hex[:10]
    request_id, file_id = f"req_ws{suffix}", f"file_ws{suffix}"

    with database.session() as session:
        user_id = user or session.execute(
            text("SELECT id FROM users ORDER BY created_at LIMIT 1")).scalar()
        bucket = session.execute(
            text("SELECT bucket FROM files WHERE bucket IS NOT NULL ORDER BY created_at DESC LIMIT 1")).scalar()
    if not user_id or not bucket:
        raise SystemExit("Need at least one existing user and one uploaded file to borrow ids from")

    object_key = f"requests/{request_id}/input/{file_id}/{book.name}"
    print(f"user={user_id}\nbucket={bucket}\nobject={object_key}\n")

    from zamp_shared.storage import GCSObjectStorage
    storage = GCSObjectStorage(PROJECT_ID)
    storage.upload_file(bucket, object_key, book)

    with database.session() as session:
        session.execute(text("""
            INSERT INTO requests (id, user_id, status, file_count, created_at, updated_at)
            VALUES (:id, :user_id, 'COLLECTING', 1, now(), now())
        """), {"id": request_id, "user_id": user_id})
        session.execute(text("""
            INSERT INTO files (id, request_id, user_id, original_filename, content_type,
                               size_bytes, bucket, object_key, stage, uploaded_at, created_at, updated_at)
            VALUES (:id, :request_id, :user_id, :filename, :mime, :size,
                    :bucket, :object_key, 'UPLOADED', now(), now(), now())
        """), {"id": file_id, "request_id": request_id, "user_id": user_id, "filename": book.name,
               "mime": XLSX, "size": book.stat().st_size, "bucket": bucket, "object_key": object_key})

    try:
        detect(database, storage, request_id, file_id)
        show(database, file_id, "after detection")
        convert(database, storage, request_id, file_id)
        show(database, file_id, "after conversion")
        show_records(database, file_id)
        print(f"\nOpen the batch at: /request/{request_id}")
    finally:
        if not keep:
            cleanup(database, file_id, request_id, bucket, object_key, storage)
        else:
            print("\n--keep: rows and object left in place")


def detect(database, storage, request_id: str, file_id: str) -> None:
    swap_to(DETECTOR_SRC)
    from app.detectors.xlsx import XlsxSchemaDetector
    from app.pipeline.detector_registry import DetectorRegistry
    from app.pipeline.schema_pipeline import SchemaPipeline
    from app.services.schema_validator import SchemaValidator
    from zamp_shared.repositories import FileRepository, SchemaRepository

    print("=== detection ===")
    SchemaPipeline(FileRepository(database), SchemaRepository(database), storage,
                   DetectorRegistry({XLSX: XlsxSchemaDetector()}), SchemaValidator(),
                   database=database, instance_id="local", lease_seconds=300,
                   topic_convert_requested="convert-requested").execute(request_id, file_id)


def convert(database, storage, request_id: str, file_id: str) -> None:
    from sqlalchemy import text

    # The Convert gate is the backend's, not the worker's.
    with database.session() as session:
        session.execute(text("UPDATE requests SET converted_at = now(), status = 'CONVERTING' WHERE id = :id"),
                        {"id": request_id})
        session.execute(text("UPDATE files SET stage = 'CONVERTING', claimed_until = NULL, attempts = 0 "
                             "WHERE id = :id"), {"id": file_id})

    swap_to(PROCESSOR_SRC)
    from app.persistence.record_writer import RecordWriter
    from app.pipeline.processing_pipeline import ProcessingPipeline
    from app.pipeline.processor_registry import ProcessorRegistry
    from app.readers.xlsx import XlsxReader
    from app.transformation.coercion import TypeCoercer
    from app.transformation.mapper import SchemaMapper
    from app.validation.deterministic import DeterministicValidator
    from zamp_shared.repositories import (
        ErrorRepository, FileRepository, ProcessingRepository, RecordRepository, SchemaRepository)

    print("\n=== conversion ===")
    ProcessingPipeline(
        FileRepository(database), SchemaRepository(database), ProcessingRepository(database), storage,
        ProcessorRegistry({XLSX: XlsxReader(chunk_size=1000)}), SchemaMapper(), TypeCoercer(),
        DeterministicValidator(), RecordWriter(RecordRepository(database), ErrorRepository(database)),
        100_000, database=database, instance_id="local", lease_seconds=300,
    ).execute(request_id, file_id)


def show(database, file_id: str, when: str) -> None:
    from sqlalchemy import text

    print(f"\n--- file_schemas / file_schema_results {when} ---")
    with database.session() as session:
        rows = session.execute(text("""
            SELECT s.table_ord, s.table_label, s.fields, r.stage::text, r.row_count,
                   r.failure_class::text, r.failure_detail
              FROM file_schemas s
              LEFT JOIN file_schema_results r ON r.file_schema_id = s.id
             WHERE s.file_id = :file_id ORDER BY s.table_ord
        """), {"file_id": file_id}).all()
        stage = session.execute(text("SELECT stage::text FROM files WHERE id = :id"), {"id": file_id}).scalar()

    for ord_, label, fields, rstage, rows_count, cls, detail in rows:
        names = [f.get("key") for f in (fields or [])]
        print(f"  ord={ord_} label={label!r} stage={rstage} rows={rows_count} fields={names}"
              + (f" failure={cls}: {detail}" if cls else ""))
    print(f"  files.stage = {stage}")


def show_records(database, file_id: str) -> None:
    import hashlib

    from sqlalchemy import text

    stem = hashlib.sha256(file_id.encode()).hexdigest()[:24]
    print("\n--- physical record tables ---")
    with database.session() as session:
        names = session.execute(text("""
            SELECT tablename FROM pg_tables
             WHERE schemaname = 'public' AND tablename LIKE :like ORDER BY tablename
        """), {"like": f"structured_records_{stem}%"}).scalars().all()

        for name in names:
            count = session.execute(text(f"SELECT count(*) FROM {name}")).scalar()
            sample = session.execute(text(f"SELECT data FROM {name} ORDER BY record_number LIMIT 2")).scalars().all()
            print(f"  {name}: {count} rows")
            for row in sample:
                print(f"      {json.dumps(row)}")
        if not names:
            print("  (none)")


def cleanup(database, file_id: str, request_id: str, bucket: str, object_key: str, storage) -> None:
    import hashlib

    from sqlalchemy import text

    stem = hashlib.sha256(file_id.encode()).hexdigest()[:24]
    with database.session() as session:
        names = session.execute(text("""
            SELECT tablename FROM pg_tables
             WHERE schemaname = 'public' AND tablename LIKE :like
        """), {"like": f"structured_records_{stem}%"}).scalars().all()
        for name in names:
            session.execute(text(f"DROP TABLE IF EXISTS {name}"))
        session.execute(text("DELETE FROM record_errors WHERE processing_run_id IN "
                             "(SELECT id FROM processing_runs WHERE file_id = :f)"), {"f": file_id})
        session.execute(text("DELETE FROM processing_runs WHERE file_id = :f"), {"f": file_id})
        session.execute(text("DELETE FROM file_schema_versions WHERE file_id = :f"), {"f": file_id})
        session.execute(text("DELETE FROM requests WHERE id = :r"), {"r": request_id})

    try:
        from google.cloud import storage as gcs
        gcs.Client(project=PROJECT_ID).bucket(bucket).blob(object_key).delete()
    except Exception as exc:  # noqa: BLE001
        print(f"  (left {object_key} behind: {exc})")
    print("\ncleaned up")


if __name__ == "__main__":
    main()
