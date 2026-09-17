from __future__ import annotations

import json
import logging
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from zamp_shared.domain import ProcessingResult, RecordError, RunStatus, SchemaVersion, SourceFile, StructuredRecord
from zamp_shared.errors import DomainError, SchemaNotApproved
from zamp_shared.repositories import Database, EventRepository, FileRepository, ProcessingRepository, SchemaRepository
from zamp_shared.storage import ObjectStorage
from app.persistence.record_writer import RecordWriter
from app.pipeline.processor_registry import ProcessorRegistry
from app.transformation.coercion import TypeCoercer
from app.transformation.mapper import SchemaMapper
from app.validation.deterministic import DeterministicValidator

log = logging.getLogger(__name__)

#: How often the per-table result row is updated while records stream past.
#: The processing screen renders row counts live, and a row_count that only
#: moves at the end is a progress bar that only ever shows 0 or 100.
PROGRESS_EVERY = 250


class ProcessingPipeline:
    def __init__(self, files: FileRepository, schemas: SchemaRepository, runs: ProcessingRepository,
                 storage: ObjectStorage, registry: ProcessorRegistry, mapper: SchemaMapper,
                 coercer: TypeCoercer, validator: DeterministicValidator, writer: RecordWriter,
                 max_records: int, *, database: Database, instance_id: str, lease_seconds: int):
        self.files, self.schemas, self.runs, self.storage = files, schemas, runs, storage
        self.registry, self.mapper, self.coercer, self.validator, self.writer = registry, mapper, coercer, validator, writer
        self.max_records = max_records
        self.events = EventRepository(database)
        self.instance_id, self.lease_seconds = instance_id, lease_seconds

    def execute(self, request_id: str | None, file_id: str, run_id: str | None = None,
                schema_version_id: str | None = None) -> ProcessingResult | None:
        source = self.files.get(request_id, file_id)

        if not self.files.claim(file_id, "convert", self.instance_id, self.lease_seconds):
            stage = self.files.stage_of(file_id)
            log.info("not claimed", extra={"fileId": file_id, "stage": stage})
            return None

        # Resolving the shape and the run can fail, and a failure here has to
        # settle the file too — otherwise it sits in CONVERTING holding a lease
        # and only fails five reclaims later, for a reason nobody can see.
        try:
            version = self._resolve_version(file_id, schema_version_id)
            run = self._resolve_run(source, version, run_id)
        except DomainError as exc:
            self.files.update_stage(file_id, "FAILED", exc.code, str(exc))
            self.schemas.set_result_stage(file_id, "FAILED", code=exc.code, detail=str(exc))
            self.events.record(request_id=source.request_id, user_id=source.user_id, file_id=file_id,
                               event_type="FILE_FAILED", message=str(exc), metadata={"code": exc.code})
            self.files.refresh_request_status(source.request_id)
            raise

        if run.status == RunStatus.COMPLETED:
            self.files.update_stage(file_id, "COMPLETED")
            return ProcessingResult(records_total=run.records_total, records_processed=run.records_processed,
                                    records_failed=run.records_failed)

        result = ProcessingResult()
        self.events.record(request_id=source.request_id, user_id=source.user_id, file_id=file_id,
                           event_type="CONVERT_STARTED", metadata={"runId": run.id, "schemaVersionId": version.id})
        try:
            self.runs.update(run.id, status=RunStatus.RUNNING, started_at=datetime.now(timezone.utc))
            self.schemas.set_result_stage(file_id, "EXTRACTING")

            with tempfile.TemporaryDirectory(prefix=f"processing-{run.id}-") as directory:
                path = Path(directory) / source.filename
                self.storage.download_to_file(source.bucket, source.object_key, path)
                self.schemas.set_result_stage(file_id, "FILLING")

                reader = self.registry.resolve(source.mime_type, source.filename)
                for number, canonical in enumerate(reader.read(source, str(path)), start=1):
                    if number > self.max_records:
                        raise DomainError("Configured record limit exceeded", "MAX_RECORDS_EXCEEDED")
                    self._one_record(run.id, file_id, number, canonical, version, result)
                    if number % PROGRESS_EVERY == 0:
                        self.schemas.set_result_stage(file_id, "FILLING", row_count=result.records_processed)
                        self.files.renew(file_id, self.instance_id, self.lease_seconds)

                summary = Path(directory) / "summary.json"
                summary.write_text(json.dumps(result.model_dump()), encoding="utf-8")
                self.storage.upload_file(source.bucket,
                                         f"requests/{source.request_id}/processing/{run.id}/summary.json", summary)

            self.schemas.set_result_stage(file_id, "DONE", row_count=result.records_processed)
            self.runs.update(run.id, status=RunStatus.COMPLETED, completed_at=datetime.now(timezone.utc), **result.model_dump())
            self.files.update_stage(file_id, "COMPLETED")
            self.events.record(request_id=source.request_id, user_id=source.user_id, file_id=file_id,
                               event_type="CONVERT_COMPLETED", metadata=result.model_dump())
            self.files.refresh_request_status(source.request_id)
            return result

        except DomainError as exc:
            self._fail(source, run.id, exc.code, str(exc), result)
            raise
        except Exception as exc:  # noqa: BLE001
            log.exception("unhandled processing failure", extra={"fileId": file_id, "runId": run.id})
            self._fail(source, run.id, "PROCESSING_FAILED", f"{type(exc).__name__}: {exc}", result)
            raise

    def _one_record(self, run_id: str, file_id: str, number: int, canonical, version: SchemaVersion,
                    result: ProcessingResult) -> None:
        result.records_total += 1
        mapped = self.mapper.map(canonical.values, version.schema_definition)
        converted: dict[str, object] = {}
        conversion_errors = []

        for field in version.schema_definition.fields:
            try:
                converted[field.name] = self.coercer.coerce(mapped[field.name], field.type)
            except Exception as exc:  # noqa: BLE001
                conversion_errors.append((field.name, getattr(exc, "code", "TYPE_COERCION_FAILED"), str(exc), mapped[field.name]))

        issues = self.validator.validate(converted, version.schema_definition)
        if conversion_errors or issues:
            result.records_failed += 1
            for field, code, message, raw in conversion_errors:
                self.writer.write_error(RecordError(processing_run_id=run_id, record_number=number,
                                                    field_name=field, error_code=code, message=message, raw_value=raw))
            for issue in issues:
                self.writer.write_error(RecordError(processing_run_id=run_id, record_number=number,
                                                    field_name=issue.field_name, error_code=issue.error_code,
                                                    message=issue.message, raw_value=issue.raw_value))
        else:
            self.writer.write_record(file_id, StructuredRecord(processing_run_id=run_id, record_number=number, data=converted))
            result.records_processed += 1

    def _resolve_version(self, file_id: str, schema_version_id: str | None) -> SchemaVersion:
        """Which shape this run is executed against.

        When the event names a version — the richer contract — it is used and
        must be approved. The backend does not publish one, because it has no
        approval step: an edit mutates `file_schemas.fields` in place and
        pressing Convert is the approval. So the run pins itself to a snapshot
        of that row taken now, which is both reproducible and what the user
        was actually looking at.
        """
        if schema_version_id:
            version = self.schemas.get(schema_version_id)
            if version.status != "APPROVED":
                raise SchemaNotApproved("The requested schema version is not approved")
            if version.file_id != file_id:
                raise DomainError("Schema version belongs to a different file", "INVALID_PROCESSING_REQUEST")
            return version
        return self.schemas.snapshot_approved(file_id)

    def _resolve_run(self, source: SourceFile, version: SchemaVersion, run_id: str | None):
        if run_id:
            run = self.runs.find(run_id)
            if run is None:
                raise DomainError(f"Processing run {run_id} was not found", "PROCESSING_RUN_NOT_FOUND")
            if run.file_id != source.id or run.file_schema_version_id != version.id:
                raise DomainError("Processing event does not match stored run", "INVALID_PROCESSING_REQUEST")
            return run
        return self.runs.open_for(source.request_id, source.id, version.id)

    def _fail(self, source: SourceFile, run_id: str, code: str, detail: str, result: ProcessingResult) -> None:
        self.files.update_stage(source.id, "FAILED", code, detail)
        self.schemas.set_result_stage(source.id, "FAILED", code=code, detail=detail)
        self.runs.update(run_id, status=RunStatus.FAILED, error_code=code, error_message=detail, **result.model_dump())
        self.events.record(request_id=source.request_id, user_id=source.user_id, file_id=source.id,
                           event_type="FILE_FAILED", message=detail, metadata={"code": code, "runId": run_id})
        self.files.refresh_request_status(source.request_id)
