from __future__ import annotations

import logging
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from zamp_shared.config import Settings
from zamp_shared.errors import DomainError
from zamp_shared.publisher import PubSubPublisher
from zamp_shared.pubsub import decode_event
from zamp_shared.repositories import Database, ErrorRepository, FileRepository, ProcessingRepository, RecordRepository, SchemaRepository
from zamp_shared.storage import GCSObjectStorage
from zamp_shared.sweep import run_sweep

from app.persistence.record_writer import RecordWriter
from app.pipeline.processing_pipeline import ProcessingPipeline
from app.pipeline.processor_registry import ProcessorRegistry
from app.readers.csv import CsvReader
from app.readers.json import JsonReader
from app.readers.xlsx import XlsxReader
from app.transformation.coercion import TypeCoercer
from app.transformation.mapper import SchemaMapper
from app.validation.deterministic import DeterministicValidator

settings = Settings(os.getenv("ZAMP_CONFIG_PATH", "config/config.yaml"))
app = FastAPI(title="Zamp Data Processor")

INSTANCE_ID = f"convert:{os.getenv('K_REVISION') or os.getenv('HOSTNAME') or os.getpid()}"

_database: Database | None = None
_pipeline: ProcessingPipeline | None = None
_publisher: PubSubPublisher | None = None


def get_database() -> Database:
    global _database
    if _database is None:
        if not settings.database.url: raise RuntimeError("ZAMP_DATABASE_URL is required")
        _database = Database(settings.database.url, settings.database.pool_size, settings.database.max_overflow)
    return _database


def get_pipeline() -> ProcessingPipeline:
    global _pipeline
    if _pipeline is None:
        database = get_database()
        registry = ProcessorRegistry({
            "text/csv": CsvReader(settings.processing.csv_chunk_size),
            "application/csv": CsvReader(settings.processing.csv_chunk_size),
            "text/plain": CsvReader(settings.processing.csv_chunk_size),
            "text/tab-separated-values": CsvReader(settings.processing.csv_chunk_size),
            "application/json": JsonReader(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": XlsxReader(settings.processing.csv_chunk_size),
        })
        _pipeline = ProcessingPipeline(
            FileRepository(database), SchemaRepository(database), ProcessingRepository(database),
            GCSObjectStorage(settings.gcp.project_id), registry, SchemaMapper(), TypeCoercer(),
            DeterministicValidator(), RecordWriter(RecordRepository(database), ErrorRepository(database)),
            settings.processing.max_records, database=database, instance_id=INSTANCE_ID,
            lease_seconds=settings.runtime.lease_seconds)
    return _pipeline


def get_publisher() -> PubSubPublisher:
    global _publisher
    if _publisher is None: _publisher = PubSubPublisher(settings.gcp.project_id)
    return _publisher


@app.get("/health")
def health() -> dict[str, str]: return {"status": "ok", "service": "data-processor"}


@app.get("/readyz")
def readiness() -> JSONResponse:
    try:
        from sqlalchemy import text
        with get_database().session() as session: session.execute(text("SELECT 1"))
        return JSONResponse({"status": "ready"})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"status": "not-ready", "error": str(exc)}, status_code=503)


@app.post("/")
async def receive_pubsub(request: Request) -> JSONResponse:
    try:
        event = decode_event(await request.json())
    except DomainError as exc:
        logging.error("undeliverable event, acknowledged and dropped", extra={"error_code": exc.code, "detail": str(exc)})
        return JSONResponse({"status": "dropped", "errorCode": exc.code}, status_code=200)

    try:
        result = get_pipeline().execute(event.request_id, event.file_id,
                                        event.processing_run_id, event.file_schema_version_id)
        if result is None:
            return JSONResponse({"status": "skipped", "fileId": event.file_id})
        return JSONResponse({"status": "completed", "fileId": event.file_id, **result.model_dump()})
    except DomainError as exc:
        logging.warning("permanent processing error", extra={"error_code": exc.code, "fileId": event.file_id})
        return JSONResponse({"status": "failed", "fileId": event.file_id, "errorCode": exc.code}, status_code=200)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="Worker dependency unavailable") from exc
    except Exception:
        logging.exception("transient processing error", extra={"fileId": event.file_id})
        raise HTTPException(status_code=500, detail="Processing failed")


@app.post("/internal/sweep")
async def sweep() -> JSONResponse:
    """See the detector's copy — same job, and both services run it so a
    single instance being cold does not stall recovery."""
    counts = run_sweep(get_database(), get_publisher(),
                       topic_file_uploaded=settings.gcp.topic_file_uploaded,
                       topic_convert_requested=settings.gcp.topic_convert_requested,
                       outbox_batch_size=settings.runtime.outbox_batch_size,
                       reap_batch_size=settings.runtime.reap_batch_size,
                       outbox_max_attempts=settings.runtime.outbox_max_attempts)
    return JSONResponse({"status": "ok", **counts})
