from __future__ import annotations

import json
import logging
import tempfile
from pathlib import Path

from zamp_shared.domain import SchemaDetectionContext, SchemaVersion, SourceFile
from zamp_shared.errors import DomainError, TransientError
from zamp_shared.repositories import Database, EventRepository, FileRepository, OutboxRepository, SchemaRepository
from zamp_shared.storage import ObjectStorage
from app.pipeline.detector_registry import DetectorRegistry
from app.services.schema_validator import SchemaValidator

log = logging.getLogger(__name__)


class SchemaPipeline:
    def __init__(self, files: FileRepository, schemas: SchemaRepository, storage: ObjectStorage,
                 registry: DetectorRegistry, validator: SchemaValidator, *, database: Database,
                 instance_id: str, lease_seconds: int, topic_convert_requested: str):
        self.files, self.schemas, self.storage = files, schemas, storage
        self.registry, self.validator = registry, validator
        self.events, self.outbox = EventRepository(database), OutboxRepository(database)
        self.instance_id, self.lease_seconds = instance_id, lease_seconds
        self.topic_convert_requested = topic_convert_requested

    def execute(self, request_id: str | None, file_id: str) -> SchemaVersion | None:
        source = self.files.get(request_id, file_id)

        # The lease is the whole concurrency control. Pub/Sub redelivers, and
        # two deliveries of the same file must not both read it: one wins the
        # single UPDATE and the other is told, truthfully, that there is
        # nothing for it to do.
        if not self.files.claim(file_id, "inspect", self.instance_id, self.lease_seconds):
            stage = self.files.stage_of(file_id)
            log.info("not claimed", extra={"fileId": file_id, "stage": stage})
            if stage in ("SCHEMA_READY", "CONVERTING", "COMPLETED"):
                return self.schemas.latest_for_file(file_id)
            return None

        self.events.record(request_id=source.request_id, user_id=source.user_id, file_id=file_id,
                           event_type="INSPECT_STARTED")
        try:
            existing = self.schemas.latest_for_file(file_id)
            # An edit or an approval means detection already finished; redoing
            # it would overwrite the shape the user is looking at.
            version = existing if existing and existing.source != "DETERMINISTIC" else None

            with tempfile.TemporaryDirectory(prefix=f"schema-{file_id}-") as directory:
                if version is None:
                    version = existing or self._detect(source, directory)

                artifact = Path(directory) / f"detected-v{version.version}.json"
                artifact.write_text(json.dumps(version.schema_definition.model_dump(mode="json"), indent=2), encoding="utf-8")
                # Under the backend's own prefix, so one request's objects sit
                # together and a lifecycle rule reaches all of them.
                self.storage.upload_file(source.bucket,
                                         f"requests/{source.request_id}/schema/{file_id}/detected-v{version.version}.json",
                                         artifact)

            self.schemas.seed_result(version, len(version.schema_definition.fields))
            self.files.update_stage(file_id, "SCHEMA_READY")
            self.events.record(request_id=source.request_id, user_id=source.user_id, file_id=file_id,
                               event_type="SCHEMA_WRITTEN",
                               metadata={"tableCount": 1, "fieldCount": len(version.schema_definition.fields)})

            self._convert_if_already_requested(source)
            return version

        except DomainError as exc:
            self._fail(source, exc.code, str(exc))
            raise
        except TransientError as exc:
            # Left in INSPECTING on purpose. _fail here would be final, because
            # claim() only takes an UPLOADED file; instead the lease lapses and
            # reap_expired returns it to UPLOADED, bounded by max_attempts.
            log.warning("deferring inspection after a transient failure",
                        extra={"fileId": file_id, "error_code": exc.code, "detail": str(exc)})
            raise
        except Exception as exc:  # noqa: BLE001
            # An unexpected error still has to settle the row. A file left in
            # INSPECTING with no lease is one the reaper picks up; a file left
            # there with a live lease is one nobody looks at until it expires.
            log.exception("unhandled inspection failure", extra={"fileId": file_id})
            self._fail(source, "INTERNAL", f"{type(exc).__name__}: {exc}")
            raise

    def _detect(self, source: SourceFile, directory: str) -> SchemaVersion:
        path = Path(directory) / source.filename
        self.storage.download_to_file(source.bucket, source.object_key, path)

        if path.stat().st_size == 0:
            raise DomainError("This file is empty.", "EMPTY_FILE")

        detector = self.registry.resolve(source.mime_type, source.filename)
        # The declared type came from the file's extension. What the detector
        # actually read is the first opinion based on the bytes, and it is what
        # the backend shows and what the processor picks a reader with.
        self.files.set_detected_content_type(source.id, source.mime_type)

        context = SchemaDetectionContext(source_file=source, local_path=str(path))
        schema = self.validator.validate(detector.detect(context))
        if not schema.fields:
            raise DomainError("Nothing table-shaped was found in this file.", "EXTRACT_EMPTY")
        return self.schemas.persist_detected(source.request_id, source.id, schema)

    def _fail(self, source: SourceFile, code: str, detail: str) -> None:
        self.files.update_stage(source.id, "FAILED", code, detail)
        self.schemas.set_result_stage(source.id, "FAILED", code=code, detail=detail)
        self.events.record(request_id=source.request_id, user_id=source.user_id, file_id=source.id,
                           event_type="FILE_FAILED", message=detail, metadata={"code": code})
        self.files.refresh_request_status(source.request_id)

    def _convert_if_already_requested(self, source: SourceFile) -> None:
        """Carry a late-arriving file into conversion by itself.

        The backend's Convert gate is arrival, not inspection: pressing it
        moves only the files already at SCHEMA_READY, and leaves the ones still
        being read. `packages/web/src/server/services/convert.ts` says so and
        expects this function to exist. Without it those files reach
        SCHEMA_READY after the gate has closed and stop there forever.
        """
        from sqlalchemy import text

        with self.files.database.session() as session:
            converted = session.execute(
                text("SELECT converted_at FROM requests WHERE id = :id"), {"id": source.request_id}
            ).scalar()
            if converted is None:
                return
            moved = session.execute(text("""
                UPDATE files SET stage = 'CONVERTING', updated_at = now()
                 WHERE id = :id AND stage = 'SCHEMA_READY' RETURNING id
            """), {"id": source.id}).first()

        if not moved:
            return
        self.outbox.enqueue(request_id=source.request_id, topic=self.topic_convert_requested,
                            payload={"fileId": source.id}, file_id=source.id)
        self.events.record(request_id=source.request_id, user_id=source.user_id, file_id=source.id,
                           event_type="CONVERT_REQUESTED", message="Carried on after the gate had already closed.")
        log.info("carried a late file into conversion", extra={"fileId": source.id})
