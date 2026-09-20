from __future__ import annotations

import hashlib
import json
import re
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from sqlalchemy import BigInteger, Column, DateTime, Enum, Integer, JSON, MetaData, String, Table, Text, UniqueConstraint, bindparam, create_engine, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from .domain import ProcessingRun, RecordError, RunStatus, Schema, SchemaStatus, SchemaVersion, SourceFile, StructuredRecord
from .errors import DomainError
from .failures import failure_class


def utcnow() -> datetime: return datetime.now(timezone.utc)


def to_backend_fields(schema: Schema) -> list[dict]:
    """Persist exactly the backend's {key,label,type,origin,required} contract.

    `origin` is not decoration: the UI marks a field the user added, and the
    backend re-derives it on every save by comparing against `original_fields`.
    A detected field that arrives without it renders as neither.
    """
    types = {"string": "text", "integer": "number", "datetime": "date", "array": "list", "object": "text", "null": "text"}
    emitted = []
    for field in schema.fields:
        backend_type = types.get(field.type, field.type)
        item = {"key": field.name, "label": field.name, "type": backend_type, "origin": "detected",
                "required": field.required, "description": field.description, "aliases": field.aliases}
        # Carried only where it means something. A `currency` left on a field
        # the user has since retyped is a claim about a column that no longer
        # holds amounts, and the schema editor strips it on the same rule.
        if backend_type == "currency" and field.currency:
            item["currency"] = field.currency
        emitted.append(item)
    return emitted


def from_backend_schema(fields: list[dict], metadata: dict | None = None) -> Schema:
    metadata = metadata or {}
    canonical_fields = metadata.get("canonical_fields")
    if canonical_fields:
        return Schema(name="records", fields=canonical_fields, metadata=metadata.get("schema", {}))
    # `currency` is deliberately NOT flattened onto `number`. It used to be,
    # and the cost was invisible: an edited schema reached the coercer as a
    # plain number, where the strict branch rejects any amount whose symbol it
    # does not know and fails the whole row over it. The lenient currency
    # branch only ever ran for a shape nobody had touched.
    types = {"text": "string", "list": "array"}
    normalized = []
    for field in fields:
        field_type = types.get(field.get("type"), field.get("type"))
        item_type = "string" if field.get("type") == "list" else None
        normalized.append({"name": field.get("key") or field.get("label"), "type": field_type,
                           "required": field.get("required", False), "description": field.get("description"),
                           "aliases": field.get("aliases", []), "item_type": item_type,
                           "currency": field.get("currency") if field_type == "currency" else None})
    return Schema(name="records", fields=normalized, metadata=metadata or {})


def shape_hash(fields: list[dict]) -> str:
    """The backend's hash, reproduced exactly.

    It is FNV-1a over sorted `key:type` and NOTHING else — see
    packages/web/src/lib/schema.ts. Two files whose tables read the same way
    must land on the same hash or "apply to all" reaches the wrong set and
    `updateSchema` refuses to save them together. Hashing the whole field dict
    (descriptions included) silently breaks both.
    """
    canonical = "|".join(sorted(f"{field['key']}:{field['type']}" for field in fields))
    value = 2166136261
    for character in canonical:
        value ^= ord(character)
        value = (value * 16777619) & 0xFFFFFFFF
    return format(value, "08x")


class Base(DeclarativeBase): pass


# The backend owns these types. `create_type=False` because the migration made
# them; `native_enum=True` because the column really is an enum and a string
# bound against it is a constraint violation, not a silent coercion.
FileStage = Enum("UPLOADING", "UPLOADED", "INSPECTING", "SCHEMA_READY", "CONVERTING", "COMPLETED", "FAILED",
                 name="file_stage", native_enum=True, create_type=False)
TableStage = Enum("QUEUED", "EXTRACTING", "FILLING", "DONE", "FAILED",
                  name="table_stage", native_enum=True, create_type=False)
OutboxStatus = Enum("PENDING", "PUBLISHED", "DEAD",
                    name="outbox_status", native_enum=True, create_type=False)
FailureClass = Enum("acquisition", "empty_file", "too_large", "archive_not_expanded",
                    "format_unsupported", "format_corrupt", "format_locked",
                    "extract_empty", "schema_not_found", "schema_inference_failed",
                    "provider_quota_exhausted", "provider_refused", "response_unparseable", "budget_exceeded",
                    "field_unresolved", "field_unsupported_by_evidence", "verification_failed",
                    "gate_not_met", "merge_incompatible",
                    "processing_failed", "max_attempts", "internal",
                    name="failure_class", native_enum=True, create_type=False)


# ---------------------------------------------------------- backend-owned

class RequestRow(Base):
    __tablename__ = "requests"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str] = mapped_column(Text, index=True)
    status: Mapped[str] = mapped_column(Text, default="COLLECTING")
    error_code: Mapped[str | None] = mapped_column(Text, nullable=True)


class FileRow(Base):
    __tablename__ = "files"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    request_id: Mapped[str] = mapped_column(Text, index=True)
    user_id: Mapped[str] = mapped_column(Text, index=True)
    original_filename: Mapped[str] = mapped_column(Text)
    content_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    detected_content_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    bucket: Mapped[str | None] = mapped_column(Text, nullable=True)
    object_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    generation: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    checksum: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_location: Mapped[str | None] = mapped_column(Text, nullable=True)
    zip_parent_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    stage: Mapped[str] = mapped_column(FileStage, default="UPLOADING", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5)
    claimed_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    claimed_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_class: Mapped[str | None] = mapped_column(FailureClass, nullable=True)
    failure_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class FileSchemaRow(Base):
    __tablename__ = "file_schemas"
    __table_args__ = (UniqueConstraint("file_id", "table_ord", name="uq_file_schemas_file_table"),)
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    file_id: Mapped[str] = mapped_column(Text, index=True)
    request_id: Mapped[str] = mapped_column(Text, index=True)
    table_ord: Mapped[int] = mapped_column(Integer)
    table_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    fields: Mapped[list] = mapped_column(JSONB)
    original_fields: Mapped[list] = mapped_column(JSONB)
    shape_hash: Mapped[str] = mapped_column(Text)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FileSchemaResultRow(Base):
    __tablename__ = "file_schema_results"
    file_schema_id: Mapped[str] = mapped_column(Text, primary_key=True)
    file_id: Mapped[str] = mapped_column(Text, index=True)
    request_id: Mapped[str] = mapped_column(Text, index=True)
    stage: Mapped[str] = mapped_column(TableStage, default="QUEUED")
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    field_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    to_check_count: Mapped[int] = mapped_column(Integer, default=0)
    progress_unit: Mapped[str | None] = mapped_column(Text, nullable=True)
    progress_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    progress_of: Mapped[int | None] = mapped_column(Integer, nullable=True)
    failure_class: Mapped[str | None] = mapped_column(FailureClass, nullable=True)
    failure_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class FileEventRow(Base):
    """The audit trail. Written in the same transaction as the change it
    describes, so the trail cannot claim something that did not happen."""
    __tablename__ = "file_events"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    request_id: Mapped[str] = mapped_column(Text, index=True)
    file_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_id: Mapped[str] = mapped_column(Text, index=True)
    request_trace_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_type: Mapped[str] = mapped_column(Text)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RequestOutboxRow(Base):
    """The backend's transactional outbox. The worker is its only relay."""
    __tablename__ = "request_outbox"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    request_id: Mapped[str] = mapped_column(Text, index=True)
    file_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    topic: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(OutboxStatus, default="PENDING", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


# ----------------------------------------------------------- worker-owned

class FileSchemaVersionRow(Base):
    """Immutable history beside the backend's live `file_schemas` row.

    The backend mutates `file_schemas.fields` in place and bumps `version`;
    it never writes here. This table is the worker's record of exactly which
    shape a run was executed against, which is what makes a run reproducible.
    """
    __tablename__ = "file_schema_versions"
    __table_args__ = (UniqueConstraint("file_schema_id", "version", name="uq_file_schema_versions_version"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    file_schema_id: Mapped[str] = mapped_column(String(64), index=True)
    request_id: Mapped[str] = mapped_column(String(64), index=True)
    file_id: Mapped[str] = mapped_column(String(64), index=True)
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32), index=True)
    fields: Mapped[list] = mapped_column(JSON)
    schema_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    source: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ProcessingRunRow(Base):
    __tablename__ = "processing_runs"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(64), index=True)
    file_id: Mapped[str] = mapped_column(String(64), index=True)
    file_schema_version_id: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    records_total: Mapped[int] = mapped_column(Integer, default=0)
    records_processed: Mapped[int] = mapped_column(Integer, default=0)
    records_failed: Mapped[int] = mapped_column(Integer, default=0)
    llm_calls: Mapped[int] = mapped_column(Integer, default=0)
    llm_repairs: Mapped[int] = mapped_column(Integer, default=0)
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # NOT NULL in the deployed table with DEFAULT now(); supplied here so a
    # locally created table behaves the same.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RecordErrorRow(Base):
    __tablename__ = "record_errors"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    processing_run_id: Mapped[str] = mapped_column(String(64), index=True)
    record_number: Mapped[int] = mapped_column(Integer)
    field_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    error_code: Mapped[str] = mapped_column(String(128))
    message: Mapped[str] = mapped_column(Text)
    raw_value: Mapped[object | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Database:
    def __init__(self, url: str, pool_size: int = 2, max_overflow: int = 2) -> None:
        options = {} if url.startswith("sqlite") else {"pool_size": pool_size, "max_overflow": max_overflow}
        self.engine = create_engine(url, pool_pre_ping=True, **options)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
    def create_worker_tables(self) -> None:
        """Development helper only; production tables are created by backend migrations."""
        Base.metadata.create_all(self.engine, tables=[
            FileSchemaVersionRow.__table__, ProcessingRunRow.__table__, RecordErrorRow.__table__,
        ])
    def create_all_for_local_test(self) -> None: Base.metadata.create_all(self.engine)
    @contextmanager
    def session(self) -> Iterator[Session]:
        with self.sessions.begin() as session: yield session


# ------------------------------------------------------------------ files

#: Which stages a role may take, and what it moves the file to. INSPECTING is
#: not decoration: while a file sits in it the backend's schema poll reports it
#: as pending, and the reaper knows it is someone's work in progress rather
#: than an upload nobody has started.
CLAIMABLE: dict[str, tuple[tuple[str, ...], str]] = {
    "inspect": (("UPLOADED",), "INSPECTING"),
    "convert": (("CONVERTING",), "CONVERTING"),
}

#: Where the reaper puts a file whose lease expired, per stage it was found in.
RECLAIM_TARGET = {"INSPECTING": "UPLOADED", "CONVERTING": "CONVERTING"}

_CLAIM_SQL = text("""
    UPDATE files
       SET stage         = CAST(:next_stage AS file_stage),
           claimed_by    = :instance_id,
           claimed_until = now() + make_interval(secs => :lease_seconds),
           attempts      = attempts + 1,
           updated_at    = now()
     WHERE id = :file_id
       AND stage::text IN :claimable
       AND (claimed_until IS NULL OR claimed_until < now())
       AND attempts < max_attempts
    RETURNING id
""").bindparams(bindparam("claimable", expanding=True))


class FileRepository:
    def __init__(self, database: Database): self.database = database

    def get(self, request_id: str | None, file_id: str) -> SourceFile:
        with self.database.session() as session:
            row = session.get(FileRow, file_id)
            if not row: raise DomainError(f"File {file_id} was not found", "FILE_NOT_FOUND")
            # request_id is optional on the wire — the file row is the authority.
            if request_id and row.request_id != request_id:
                raise DomainError(f"File {file_id} is not in request {request_id}", "FILE_NOT_FOUND")
            if not row.bucket or not row.object_key:
                raise DomainError("File upload metadata is incomplete", "FILE_NOT_FOUND")
            return SourceFile(id=row.id, request_id=row.request_id, user_id=row.user_id, bucket=row.bucket,
                              object_key=row.object_key, filename=row.original_filename,
                              mime_type=row.detected_content_type or row.content_type or "",
                              size_bytes=row.size_bytes or 0)

    def stage_of(self, file_id: str) -> str | None:
        with self.database.session() as session:
            row = session.get(FileRow, file_id)
            return row.stage if row else None

    def update_stage(self, file_id: str, stage: str, code: str | None = None, detail: str | None = None) -> None:
        """Advance the file. A failure code is translated on the way in — the
        column is an enum and an unmapped value aborts the transaction."""
        with self.database.session() as session:
            row = session.get(FileRow, file_id)
            if not row: raise DomainError(f"File {file_id} was not found", "FILE_NOT_FOUND")
            row.stage = stage
            row.failure_class = failure_class(code) if stage == "FAILED" else None
            row.failure_detail = (detail or "")[:2000] if stage == "FAILED" else None
            row.updated_at = utcnow()
            if stage in ("SCHEMA_READY", "COMPLETED", "FAILED"):
                row.claimed_by, row.claimed_until = None, None

    def set_detected_content_type(self, file_id: str, detected: str) -> None:
        with self.database.session() as session:
            row = session.get(FileRow, file_id)
            if row: row.detected_content_type, row.updated_at = detected, utcnow()

    def claim(self, file_id: str, role: str, instance_id: str, lease_seconds: int) -> bool:
        """Take the file, or say it is not ours to take.

        One statement, so two concurrent deliveries cannot both win: PostgreSQL
        serialises the row update and exactly one of them matches the WHERE.
        """
        claimable, next_stage = CLAIMABLE[role]
        with self.database.session() as session:
            claimed = session.execute(_CLAIM_SQL, {
                "file_id": file_id, "instance_id": instance_id, "lease_seconds": lease_seconds,
                "next_stage": next_stage, "claimable": list(claimable),
            }).first()
            return claimed is not None

    def renew(self, file_id: str, instance_id: str, lease_seconds: int) -> None:
        with self.database.session() as session:
            session.execute(text("""
                UPDATE files SET claimed_until = now() + make_interval(secs => :lease_seconds), updated_at = now()
                 WHERE id = :file_id AND claimed_by = :instance_id
            """), {"file_id": file_id, "instance_id": instance_id, "lease_seconds": lease_seconds})

    def reap_expired(self, batch_size: int = 100) -> list[dict]:
        """Files whose lease ran out. Returns what was reclaimed so the caller
        can put each one back on the topic that matches its stage."""
        reclaimed = []
        with self.database.session() as session:
            rows = session.execute(text("""
                SELECT id, request_id, user_id, stage::text AS stage, attempts, max_attempts
                  FROM files
                 WHERE stage::text IN ('INSPECTING', 'CONVERTING')
                   AND claimed_until IS NOT NULL AND claimed_until < now()
                 ORDER BY claimed_until
                 LIMIT :batch_size
                   FOR UPDATE SKIP LOCKED
            """), {"batch_size": batch_size}).mappings().all()

            for row in rows:
                if row["attempts"] >= row["max_attempts"]:
                    session.execute(text("""
                        UPDATE files SET stage = 'FAILED', failure_class = 'max_attempts',
                               failure_detail = :detail, claimed_by = NULL, claimed_until = NULL, updated_at = now()
                         WHERE id = :id
                    """), {"id": row["id"], "detail": f"Gave up after {row['attempts']} attempts."})
                    continue
                session.execute(text("""
                    UPDATE files SET stage = CAST(:stage AS file_stage), claimed_by = NULL,
                           claimed_until = NULL, updated_at = now()
                     WHERE id = :id
                """), {"id": row["id"], "stage": RECLAIM_TARGET[row["stage"]]})
                reclaimed.append(dict(row))
        return reclaimed

    def refresh_request_status(self, request_id: str) -> None:
        """Recompute the request from its files, the same way the backend does.

        Without this a request whose files all finished still reads CONVERTING
        until the next backend call happens to recompute it.
        """
        with self.database.session() as session:
            session.execute(text("""
                WITH counts AS (
                  SELECT COUNT(*) AS total,
                         COUNT(*) FILTER (WHERE stage = 'FAILED') AS failed,
                         COUNT(*) FILTER (WHERE stage IN ('COMPLETED', 'FAILED')) AS settled
                    FROM files WHERE request_id = :request_id AND deleted_at IS NULL
                )
                UPDATE requests r
                   SET status = CAST(CASE
                         WHEN c.total = 0 THEN 'COLLECTING'
                         WHEN c.settled < c.total THEN r.status::text
                         WHEN c.failed = c.total THEN 'FAILED'
                         ELSE 'COMPLETED'
                       END AS request_status),
                       updated_at = now()
                  FROM counts c
                 WHERE r.id = :request_id AND r.converted_at IS NOT NULL
            """), {"request_id": request_id})


# ----------------------------------------------------------------- events

class EventRepository:
    def __init__(self, database: Database): self.database = database

    def record(self, *, request_id: str, user_id: str, event_type: str, file_id: str | None = None,
               message: str | None = None, metadata: dict[str, Any] | None = None,
               request_trace_id: str | None = None) -> None:
        # user_id is NOT NULL and carries a foreign key. A worker that only
        # knows the file resolves it rather than inventing one.
        with self.database.session() as session:
            if not user_id and file_id:
                row = session.get(FileRow, file_id)
                user_id = row.user_id if row else ""
            if not user_id or not request_id:
                return
            session.execute(text("""
                INSERT INTO file_events (request_id, file_id, user_id, request_trace_id, event_type, message, metadata, created_at)
                VALUES (:request_id, :file_id, :user_id, :request_trace_id, :event_type, :message, CAST(:metadata AS jsonb), now())
            """), {"request_id": request_id, "file_id": file_id, "user_id": user_id,
                   "request_trace_id": request_trace_id, "event_type": event_type, "message": message,
                   "metadata": json.dumps(metadata) if metadata is not None else None})


# ----------------------------------------------------------------- outbox

class OutboxRepository:
    """The relay for rows the backend committed but could not publish.

    The backend writes the outbox row inside the same transaction as the state
    change, then publishes best-effort and swallows the error. Nothing else
    recovers a row whose publish failed — which is why this has to exist and
    why the sweep that drives it is not optional.
    """

    def __init__(self, database: Database): self.database = database

    _CLAIM = text("""
        UPDATE request_outbox
           SET attempts        = attempts + 1,
               next_attempt_at = now() + make_interval(secs => LEAST(3600, 10 * POWER(2, LEAST(attempts, 8)))),
               updated_at      = now()
         WHERE id IN (
               SELECT id FROM request_outbox
                WHERE status = 'PENDING' AND next_attempt_at <= now()
                ORDER BY created_at LIMIT :batch_size
                  FOR UPDATE SKIP LOCKED)
        RETURNING id, request_id, file_id, topic, payload, attempts
    """)

    def claim_pending(self, batch_size: int) -> list[dict]:
        """Take a batch and back it off in the same statement.

        `FOR UPDATE SKIP LOCKED` is what makes concurrent sweeps safe: two
        overlapping runs claim disjoint rows rather than double-publishing.
        Backing off on claim rather than on failure means a row whose publish
        crashes the process still comes back later instead of spinning.
        """
        with self.database.session() as session:
            return [dict(r) for r in session.execute(self._CLAIM, {"batch_size": batch_size}).mappings().all()]

    def enqueue(self, *, request_id: str, topic: str, payload: dict, file_id: str | None = None) -> int:
        with self.database.session() as session:
            row = session.execute(text("""
                INSERT INTO request_outbox (request_id, file_id, topic, payload, status, attempts, next_attempt_at, created_at, updated_at)
                VALUES (:request_id, :file_id, :topic, CAST(:payload AS jsonb), 'PENDING', 0, now(), now(), now())
                RETURNING id
            """), {"request_id": request_id, "file_id": file_id, "topic": topic, "payload": json.dumps(payload)}).first()
            return int(row[0])

    def mark_published(self, outbox_id: int) -> None:
        with self.database.session() as session:
            session.execute(text("""
                UPDATE request_outbox SET status = 'PUBLISHED', published_at = now(), last_error = NULL, updated_at = now()
                 WHERE id = :id
            """), {"id": outbox_id})

    def mark_failed(self, outbox_id: int, error: str) -> None:
        """Left PENDING — `claim_pending` has already pushed the next attempt out."""
        with self.database.session() as session:
            session.execute(text("UPDATE request_outbox SET last_error = :error, updated_at = now() WHERE id = :id"),
                            {"id": outbox_id, "error": error[:2000]})

    def mark_dead(self, outbox_id: int, error: str) -> None:
        """Give up on the message and fail the file it belonged to.

        The only path by which a publish failure becomes a failed file, and it
        happens after hours of retries rather than on the first error.
        """
        with self.database.session() as session:
            row = session.execute(text("""
                UPDATE request_outbox SET status = 'DEAD', last_error = :error, updated_at = now()
                 WHERE id = :id RETURNING file_id
            """), {"id": outbox_id, "error": error[:2000]}).first()
            if row and row[0]:
                session.execute(text("""
                    UPDATE files SET stage = 'FAILED', failure_class = 'internal', failure_detail = :detail, updated_at = now()
                     WHERE id = :file_id AND stage NOT IN ('COMPLETED', 'FAILED')
                """), {"file_id": row[0], "detail": "The job could not be queued."})


# ---------------------------------------------------------------- schemas

class SchemaRepository:
    def __init__(self, database: Database): self.database = database

    def latest_for_file(self, file_id: str) -> SchemaVersion | None:
        with self.database.session() as session:
            row = session.scalar(select(FileSchemaVersionRow).where(FileSchemaVersionRow.file_id == file_id)
                                 .order_by(FileSchemaVersionRow.created_at.desc()))
            return self._to_model(row) if row else None

    def get(self, schema_version_id: str) -> SchemaVersion:
        with self.database.session() as session:
            row = session.get(FileSchemaVersionRow, schema_version_id)
            if not row: raise DomainError(f"Schema version {schema_version_id} was not found", "SCHEMA_NOT_FOUND")
            return self._to_model(row)

    def persist_table(self, request_id: str, file_id: str, table_ord: int,
                      table_label: str | None, fields: list[dict]) -> str:
        """Write the live `file_schemas` row for one table and return its id.

        Idempotent under redelivery: the INSERT carries ON CONFLICT against the
        backend's UNIQUE(file_id, table_ord), so a second delivery finds the
        row rather than raising — a SELECT-then-INSERT has a race in it that
        redelivery reliably finds. That constraint is also the whole of the
        worksheet identity: `table_ord` IS the sheet's index, so the same sheet
        of the same workbook always resolves to the same row however often the
        finalisation event arrives.

        `fields` may be empty. A worksheet that yielded no columns still gets a
        row, because dropping it would renumber every sheet after it and make
        the identity depend on the content.
        """
        with self.database.session() as session:
            session.execute(text("""
                INSERT INTO file_schemas (id, file_id, request_id, table_ord, table_label, version,
                                          fields, original_fields, shape_hash, created_at)
                VALUES (:id, :file_id, :request_id, :table_ord, :table_label, 1,
                        CAST(:fields AS jsonb), CAST(:fields AS jsonb), :shape_hash, now())
                ON CONFLICT (file_id, table_ord) DO NOTHING
            """), {"id": f"sch_{uuid.uuid4().hex[:16]}", "file_id": file_id, "request_id": request_id,
                   "table_ord": table_ord, "table_label": table_label,
                   "fields": json.dumps(fields), "shape_hash": shape_hash(fields)})

            parent = session.scalar(select(FileSchemaRow).where(
                FileSchemaRow.file_id == file_id, FileSchemaRow.table_ord == table_ord))
            if parent is None:
                raise DomainError("Could not persist the detected schema", "SCHEMA_NOT_FOUND")
            return parent.id

    def tables_for_file(self, file_id: str) -> list[dict]:
        """Every table of this file in ordinal order, with the stage of each."""
        with self.database.session() as session:
            rows = session.execute(text("""
                SELECT s.id AS file_schema_id, s.table_ord, s.table_label, s.fields,
                       r.stage::text AS stage
                  FROM file_schemas s
                  LEFT JOIN file_schema_results r ON r.file_schema_id = s.id
                 WHERE s.file_id = :file_id
                 ORDER BY s.table_ord
            """), {"file_id": file_id}).mappings().all()
            return [dict(row) for row in rows]

    def versions_for_file(self, file_id: str) -> dict[int, SchemaVersion]:
        """The newest version of each table, keyed by the table's ordinal."""
        with self.database.session() as session:
            rows = session.execute(text("""
                SELECT DISTINCT ON (s.table_ord) s.table_ord, v.id
                  FROM file_schemas s
                  JOIN file_schema_versions v ON v.file_schema_id = s.id
                 WHERE s.file_id = :file_id
                 ORDER BY s.table_ord, v.version DESC
            """), {"file_id": file_id}).all()

            versions: dict[int, SchemaVersion] = {}
            for table_ord, version_id in rows:
                row = session.get(FileSchemaVersionRow, version_id)
                if row is not None:
                    versions[int(table_ord)] = self._to_model(row)
            return versions

    def persist_detected(self, request_id: str, file_id: str, schema: Schema,
                         table_ord: int = 0, table_label: str | None = None) -> SchemaVersion:
        """Write the live `file_schemas` row and the v1 history row beside it."""
        fields = to_backend_fields(schema)
        schema_metadata = {"schema": schema.metadata, "canonical_fields": [f.model_dump(mode="json") for f in schema.fields]}
        schema_id = self.persist_table(request_id, file_id, table_ord, table_label or schema.name, fields)

        with self.database.session() as session:
            parent = session.get(FileSchemaRow, schema_id)

            existing = session.scalar(select(FileSchemaVersionRow)
                                      .where(FileSchemaVersionRow.file_schema_id == parent.id)
                                      .order_by(FileSchemaVersionRow.version.desc()))
            if existing: return self._to_model(existing)

            row = FileSchemaVersionRow(id=str(uuid.uuid4()), file_schema_id=parent.id, request_id=request_id,
                                       file_id=file_id, version=1, status=SchemaStatus.READY_FOR_REVIEW.value,
                                       fields=fields, schema_metadata=schema_metadata, source="DETERMINISTIC")
            session.add(row); session.flush()
            return self._to_model(row)

    def snapshot_approved(self, file_id: str, table_ord: int = 0) -> SchemaVersion:
        """Freeze whatever `file_schemas` holds right now as an APPROVED version.

        The backend has no approval step: a user edit mutates `file_schemas.
        fields` in place and bumps `version`, and pressing Convert is the
        approval. So the run is pinned to a snapshot taken here, at the moment
        conversion starts, rather than to a version the backend never wrote.
        """
        with self.database.session() as session:
            parent = session.scalar(select(FileSchemaRow).where(
                FileSchemaRow.file_id == file_id, FileSchemaRow.table_ord == table_ord))
            if parent is None:
                raise DomainError(f"File {file_id} has no detected schema to convert against", "SCHEMA_NOT_FOUND")

            latest = session.scalar(select(FileSchemaVersionRow)
                                    .where(FileSchemaVersionRow.file_schema_id == parent.id)
                                    .order_by(FileSchemaVersionRow.version.desc()))

            # Re-approving an unchanged shape would pile up identical rows on
            # every redelivery; the same fields under APPROVED is already it.
            if latest and latest.status == SchemaStatus.APPROVED.value and latest.fields == parent.fields:
                return self._to_model(latest)

            metadata = dict(latest.schema_metadata) if latest else {}
            # The canonical (worker-side) field list belongs to the detected
            # shape. Once the user has edited, the backend's list is the truth.
            if latest and latest.fields != parent.fields:
                metadata.pop("canonical_fields", None)

            row = FileSchemaVersionRow(id=str(uuid.uuid4()), file_schema_id=parent.id, request_id=parent.request_id,
                                       file_id=file_id, version=(latest.version if latest else 0) + 1,
                                       status=SchemaStatus.APPROVED.value, fields=list(parent.fields),
                                       schema_metadata=metadata, source="USER_APPROVED")
            session.add(row); session.flush()
            return self._to_model(row)

    def persist_user_edit(self, schema_version_id: str, schema: Schema) -> SchemaVersion:
        return self._persist_next(self.get(schema_version_id), schema, "USER_EDITED", SchemaStatus.READY_FOR_REVIEW)

    def approve(self, schema_version_id: str) -> SchemaVersion:
        current = self.get(schema_version_id)
        if current.status != SchemaStatus.READY_FOR_REVIEW:
            raise DomainError("Only a reviewable schema version can be approved", "INVALID_SCHEMA_STATE")
        return self._persist_next(current, current.schema_definition, "USER_APPROVED", SchemaStatus.APPROVED)

    def schema_ids_for_file(self, file_id: str) -> list[str]:
        with self.database.session() as session:
            return list(session.scalars(select(FileSchemaRow.id).where(FileSchemaRow.file_id == file_id)
                                        .order_by(FileSchemaRow.table_ord)))

    def seed_result(self, request_id: str, file_id: str, file_schema_id: str, field_count: int) -> None:
        """Seed the per-table result row so the result poll can count it.

        QUEUED, not DONE. The five counts the processing screen renders must
        sum to the number of tables in the request, and a table that reports
        DONE the moment its shape is read shows a conversion that never ran.
        """
        with self.database.session() as session:
            session.execute(text("""
                INSERT INTO file_schema_results (file_schema_id, file_id, request_id, stage, row_count,
                                                 field_count, to_check_count, updated_at)
                VALUES (:file_schema_id, :file_id, :request_id, 'QUEUED', 0, :field_count, 0, now())
                ON CONFLICT (file_schema_id) DO UPDATE SET field_count = EXCLUDED.field_count, updated_at = now()
            """), {"file_schema_id": file_schema_id, "file_id": file_id,
                   "request_id": request_id, "field_count": field_count})

    def set_result_stage(self, file_id: str, stage: str, *, file_schema_id: str | None = None,
                         row_count: int | None = None,
                         progress: tuple[str, int, int] | None = None, code: str | None = None,
                         detail: str | None = None) -> None:
        """Move one table of this file to `stage`, or every table when no table
        is named.

        Both forms are real. A worksheet that failed on its own is one table;
        a file that could not be downloaded at all failed every table it has,
        and saying that once is honest rather than lossy."""
        sets = ["stage = CAST(:stage AS table_stage)", "updated_at = now()"]
        params: dict[str, Any] = {"file_id": file_id, "stage": stage}
        if row_count is not None:
            sets.append("row_count = :row_count"); params["row_count"] = row_count
        if progress is not None:
            sets.append("progress_unit = :unit"); sets.append("progress_at = :at"); sets.append("progress_of = :of")
            params["unit"], params["at"], params["of"] = progress
        if stage == "EXTRACTING":
            sets.append("started_at = COALESCE(started_at, now())")
        if stage in ("DONE", "FAILED"):
            sets.append("completed_at = now()")
        if stage == "FAILED":
            sets.append("failure_class = CAST(:failure_class AS failure_class)"); sets.append("failure_detail = :detail")
            params["failure_class"], params["detail"] = failure_class(code), (detail or "")[:2000]
        where = "file_id = :file_id"
        if file_schema_id is not None:
            where += " AND file_schema_id = :file_schema_id"
            params["file_schema_id"] = file_schema_id

        with self.database.session() as session:
            session.execute(text(f"UPDATE file_schema_results SET {', '.join(sets)} WHERE {where}"), params)

    def _persist_next(self, current: SchemaVersion, schema: Schema, source: str, status: SchemaStatus) -> SchemaVersion:
        fields = to_backend_fields(schema)
        schema_metadata = {"schema": schema.metadata, "canonical_fields": [f.model_dump(mode="json") for f in schema.fields]}
        with self.database.session() as session:
            latest = session.scalar(select(FileSchemaVersionRow)
                                    .where(FileSchemaVersionRow.file_schema_id == current.file_schema_id)
                                    .order_by(FileSchemaVersionRow.version.desc()))
            row = FileSchemaVersionRow(id=str(uuid.uuid4()), file_schema_id=current.file_schema_id,
                                       request_id=current.request_id, file_id=current.file_id,
                                       version=(latest.version if latest else 0) + 1, status=status.value,
                                       fields=fields, schema_metadata=schema_metadata, source=source)
            session.add(row); session.flush(); return self._to_model(row)

    @staticmethod
    def _to_model(row: FileSchemaVersionRow) -> SchemaVersion:
        return SchemaVersion(id=row.id, file_schema_id=row.file_schema_id, request_id=row.request_id,
                             file_id=row.file_id, version=row.version, status=row.status,
                             schema=from_backend_schema(row.fields, row.schema_metadata),
                             source=row.source, created_at=row.created_at)


# ------------------------------------------------------------ processing

class ProcessingRepository:
    def __init__(self, database: Database): self.database = database

    def get(self, run_id: str) -> ProcessingRun:
        with self.database.session() as session:
            row = session.get(ProcessingRunRow, run_id)
            if not row: raise DomainError(f"Processing run {run_id} was not found", "PROCESSING_RUN_NOT_FOUND")
            return self._to_model(row)

    def find(self, run_id: str) -> ProcessingRun | None:
        with self.database.session() as session:
            row = session.get(ProcessingRunRow, run_id)
            return self._to_model(row) if row else None

    def create(self, run: ProcessingRun) -> None:
        with self.database.session() as session: session.add(ProcessingRunRow(**run.model_dump()))

    def open_for(self, request_id: str, file_id: str, schema_version_id: str) -> ProcessingRun:
        """The run for this conversion, created if the backend did not make one.

        The backend has no `processing_runs` concept, so on the event it does
        publish there is nothing to look up. The id is derived from the schema
        version rather than random, which makes a redelivery find the same run
        instead of starting a second one against the same file.
        """
        run_id = f"run_{hashlib.sha256(f'{file_id}:{schema_version_id}'.encode()).hexdigest()[:24]}"
        with self.database.session() as session:
            existing = session.get(ProcessingRunRow, run_id)
            if existing: return self._to_model(existing)
            row = ProcessingRunRow(id=run_id, request_id=request_id, file_id=file_id,
                                   file_schema_version_id=schema_version_id, status=RunStatus.PENDING.value)
            session.add(row); session.flush(); return self._to_model(row)

    def update(self, run_id: str, **values: object) -> ProcessingRun:
        with self.database.session() as session:
            row = session.get(ProcessingRunRow, run_id)
            if not row: raise DomainError(f"Processing run {run_id} was not found", "PROCESSING_RUN_NOT_FOUND")
            for name, value in values.items():
                setattr(row, name, value.value if isinstance(value, RunStatus) else value)
            session.flush(); return self._to_model(row)

    @staticmethod
    def _to_model(row: ProcessingRunRow) -> ProcessingRun:
        return ProcessingRun(**{name: getattr(row, name) for name in ProcessingRun.model_fields})


class RecordRepository:
    def __init__(self, database: Database): self.database, self.tables = database, {}

    def table_name(self, file_id: str, table_ord: int) -> str:
        """Where one TABLE's rows live.

        Named from the file and the table's ordinal, so the two worksheets of a
        workbook are two physical tables rather than one table holding both.
        The file's hash stays the stem, which keeps one file's tables visibly
        related; the ordinal is a readable suffix rather than part of the hash,
        so the name says which worksheet it is.
        """
        if not re.fullmatch(r"[A-Za-z0-9_-]+", file_id): raise DomainError("Invalid file ID", "INVALID_FILE_ID")
        if not isinstance(table_ord, int) or table_ord < 0 or table_ord > 999:
            raise DomainError("Invalid table ordinal", "INVALID_TABLE_ORD")
        return f"structured_records_{hashlib.sha256(file_id.encode()).hexdigest()[:24]}_t{table_ord}"

    def _table(self, file_id: str, table_ord: int) -> Table:
        table_name = self.table_name(file_id, table_ord)
        table = self.tables.get(table_name)
        if table is None:
            table = Table(table_name, MetaData(),
                          Column("id", String(64), primary_key=True),
                          Column("processing_run_id", String(64), nullable=False, index=True),
                          Column("record_number", Integer, nullable=False),
                          Column("data", JSON, nullable=False),
                          Column("status", String(32), nullable=False, default="VALID"),
                          Column("created_at", DateTime(timezone=True), nullable=False, default=utcnow),
                          UniqueConstraint("processing_run_id", "record_number", name=f"uq_{table_name}_run_number"))
            table.create(self.database.engine, checkfirst=True)
            self.tables[table_name] = table
        return table
    def write(self, file_id: str, table_ord: int, record: StructuredRecord) -> None:
        table = self._table(file_id, table_ord)
        with self.database.session() as session:
            existing = session.execute(select(table.c.id).where(
                table.c.processing_run_id == record.processing_run_id,
                table.c.record_number == record.record_number)).first()
            if not existing: session.execute(table.insert().values(id=str(uuid.uuid4()), **record.model_dump(mode="json")))


class ErrorRepository:
    def __init__(self, database: Database): self.database = database
    def write(self, error: RecordError) -> None:
        with self.database.session() as session:
            session.add(RecordErrorRow(id=str(uuid.uuid4()), **error.model_dump(mode="json")))
