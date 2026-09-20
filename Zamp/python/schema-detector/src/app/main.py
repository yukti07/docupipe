from __future__ import annotations

import logging
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from zamp_shared.config import Settings
from zamp_shared.errors import DomainError
from zamp_shared.publisher import PubSubPublisher
from zamp_shared.pubsub import decode_event
from zamp_shared.repositories import Database, FileRepository, SchemaRepository
from zamp_shared.llm import GeminiClient, PromptRepository
from zamp_shared.storage import GCSObjectStorage
from zamp_shared.sweep import run_sweep

from app.detectors.base import SchemaDetector
from app.detectors.csv import CsvSchemaDetector
from app.detectors.gemini import GeminiSchemaDetector
from app.detectors.image import SUPPORTED_MIME_TYPES as IMAGE_MIME_TYPES, GeminiImageSchemaDetector
from app.detectors.json import JsonSchemaDetector
from app.detectors.xlsx import XlsxSchemaDetector
from app.pipeline.detector_registry import DetectorRegistry
from app.pipeline.schema_pipeline import SchemaPipeline
from app.services.schema_validator import SchemaValidator

settings = Settings(os.getenv("ZAMP_CONFIG_PATH", "config/config.yaml"))
app = FastAPI(title="Zamp Schema Detector")

#: Cloud Run gives every instance an id; the lease records which process holds
#: a file so the reaper can tell a dead worker from a busy one.
INSTANCE_ID = f"inspect:{os.getenv('K_REVISION') or os.getenv('HOSTNAME') or os.getpid()}"

_database: Database | None = None
_pipeline: SchemaPipeline | None = None
_publisher: PubSubPublisher | None = None


def get_database() -> Database:
    global _database
    if _database is None:
        if not settings.database.url: raise RuntimeError("ZAMP_DATABASE_URL is required")
        _database = Database(settings.database.url, settings.database.pool_size, settings.database.max_overflow)
    return _database


def get_pipeline() -> SchemaPipeline:
    global _pipeline
    if _pipeline is None:
        database = get_database()
        detectors: dict[str, SchemaDetector] = {
            "text/csv": CsvSchemaDetector(settings.schema.sample_rows),
            "application/csv": CsvSchemaDetector(settings.schema.sample_rows),
            "text/plain": CsvSchemaDetector(settings.schema.sample_rows),
            "text/tab-separated-values": CsvSchemaDetector(settings.schema.sample_rows),
            "application/json": JsonSchemaDetector(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": XlsxSchemaDetector(settings.schema.sample_rows),
        }
        fallback = None
        if settings.llm.enabled and settings.llm.provider == "gemini" and settings.llm.api_key:
            client = GeminiClient(settings.llm.api_key, settings.llm.model or "gemini-3.5-flash",
                                  temperature=settings.llm.temperature,
                                  max_output_tokens=settings.llm.max_output_tokens,
                                  max_retries=settings.llm.max_retries,
                                  timeout_seconds=settings.llm.timeout_seconds)
            fallback = GeminiSchemaDetector(client, settings.schema.max_sample_bytes, settings.schema.max_pdf_bytes)
            # One instance for every image type. A per-MIME branch here would be
            # the same detector written out seven times.
            image = GeminiImageSchemaDetector(client, PromptRepository(settings.schema.prompts_dir),
                                              settings.schema.max_image_bytes)
            detectors.update(dict.fromkeys(IMAGE_MIME_TYPES, image))
        registry = DetectorRegistry(detectors, fallback)
        _pipeline = SchemaPipeline(
            FileRepository(database), SchemaRepository(database), GCSObjectStorage(settings.gcp.project_id),
            registry, SchemaValidator(), database=database, instance_id=INSTANCE_ID,
            lease_seconds=settings.runtime.lease_seconds,
            topic_convert_requested=settings.gcp.topic_convert_requested)
    return _pipeline


def get_publisher() -> PubSubPublisher:
    global _publisher
    if _publisher is None: _publisher = PubSubPublisher(settings.gcp.project_id)
    return _publisher


@app.get("/health")
def health() -> dict[str, str]: return {"status": "ok", "service": "schema-detector"}


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
        # A malformed message cannot become well-formed on redelivery, so it
        # is acknowledged. Logged loudly, because an acked message leaves no
        # other trace anywhere.
        logging.error("undeliverable event, acknowledged and dropped", extra={"error_code": exc.code, "detail": str(exc)})
        return JSONResponse({"status": "dropped", "errorCode": exc.code}, status_code=200)

    try:
        result = get_pipeline().execute(event.request_id, event.file_id)
        if result is None:
            return JSONResponse({"status": "skipped", "fileId": event.file_id})
        return JSONResponse({"status": "ok", "fileId": event.file_id, "schemaVersionId": result.id, "schemaStatus": result.status})
    except DomainError as exc:
        # The file row has already been settled as FAILED by the pipeline, so
        # redelivery would only repeat a decision that is already recorded.
        logging.warning("permanent schema detection error", extra={"error_code": exc.code, "fileId": event.file_id})
        return JSONResponse({"status": "failed", "fileId": event.file_id, "errorCode": exc.code}, status_code=200)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="Worker dependency unavailable") from exc
    except Exception:
        # Transient: let Pub/Sub redeliver. The lease has already expired or
        # will, and the reaper puts the file back.
        logging.exception("transient schema detection error", extra={"fileId": event.file_id})
        raise HTTPException(status_code=500, detail="Schema detection failed")


@app.post("/internal/sweep")
async def sweep() -> JSONResponse:
    """Relay the outbox and reclaim expired leases.

    Not optional. It is the only thing that recovers an outbox row whose inline
    publish from the backend failed, and the only thing that reclaims a file
    from a worker that died holding it. Cloud Scheduler calls this once a
    minute; without it both wait for a coincidence.
    """
    counts = run_sweep(get_database(), get_publisher(),
                       topic_file_uploaded=settings.gcp.topic_file_uploaded,
                       topic_convert_requested=settings.gcp.topic_convert_requested,
                       outbox_batch_size=settings.runtime.outbox_batch_size,
                       reap_batch_size=settings.runtime.reap_batch_size,
                       outbox_max_attempts=settings.runtime.outbox_max_attempts)
    return JSONResponse({"status": "ok", **counts})
