"""SQLAlchemy Core table definitions.

These MIRROR the Prisma schema in packages/db — they do not own it. Nothing
here ever emits DDL, and `metadata.create_all()` is deliberately never called
in production code: two tools pointed at one database is the standard way to
lose a column.

If a column is added in packages/db, add it here in the same change.
"""

from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Enum,
    Integer,
    MetaData,
    String,
    Table,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB

metadata = MetaData()

REQUEST_STATUS = (
    "COLLECTING",
    "READY",
    "CONVERTING",
    "PAUSED",
    "COMPLETED",
    "FAILED",
)

FILE_STAGE = (
    "UPLOADING",
    "UPLOADED",
    "INSPECTING",
    "SCHEMA_READY",
    "CONVERTING",
    "COMPLETED",
    "FAILED",
)

TABLE_STAGE = ("QUEUED", "EXTRACTING", "FILLING", "DONE", "FAILED")

OUTBOX_STATUS = ("PENDING", "PUBLISHED", "DEAD")

# Must match the `failure_class` Postgres enum exactly. See failures.py for
# the canonical list and the three other places it is mirrored.
FAILURE_CLASS = (
    "acquisition",
    "empty_file",
    "too_large",
    "archive_not_expanded",
    "format_unsupported",
    "format_corrupt",
    "format_locked",
    "extract_empty",
    "schema_not_found",
    "schema_inference_failed",
    "provider_quota_exhausted",
    "provider_refused",
    "response_unparseable",
    "budget_exceeded",
    "field_unresolved",
    "field_unsupported_by_evidence",
    "verification_failed",
    "gate_not_met",
    "merge_incompatible",
    "processing_failed",
    "max_attempts",
    "internal",
)


def _enum(*values: str, name: str) -> Enum:
    # create_type=False: Prisma's migration already created the type.
    return Enum(*values, name=name, create_type=False, native_enum=True)


users = Table(
    "users",
    metadata,
    Column("id", Text, primary_key=True),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    Column("last_seen_at", DateTime(timezone=True), nullable=False),
)

user_allowance = Table(
    "user_allowance",
    metadata,
    Column("user_id", Text, primary_key=True),
    Column("used", Integer, nullable=False),
    Column("daily_limit", Integer, nullable=False),
    Column("resets_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)

requests = Table(
    "requests",
    metadata,
    Column("id", Text, primary_key=True),
    Column("user_id", Text, nullable=False),
    Column("status", _enum(*REQUEST_STATUS, name="request_status"), nullable=False),
    Column("format", Text),
    Column("file_count", Integer, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    Column("converted_at", DateTime(timezone=True)),
    Column("paused_until", DateTime(timezone=True)),
    Column("error_code", Text),
)

files = Table(
    "files",
    metadata,
    Column("id", Text, primary_key=True),
    Column("request_id", Text, nullable=False),
    Column("user_id", Text, nullable=False),
    Column("original_filename", Text, nullable=False),
    Column("content_type", Text),
    Column("detected_content_type", Text),
    Column("size_bytes", BigInteger),
    Column("bucket", Text),
    Column("object_key", Text),
    Column("generation", BigInteger),
    Column("checksum", Text),
    Column("file_location", Text),
    Column("zip_parent_name", Text),
    Column("stage", _enum(*FILE_STAGE, name="file_stage"), nullable=False),
    Column("attempts", Integer, nullable=False),
    Column("max_attempts", Integer, nullable=False),
    Column("claimed_by", Text),
    Column("claimed_until", DateTime(timezone=True)),
    Column("failure_class", _enum(*FAILURE_CLASS, name="failure_class")),
    Column("failure_detail", Text),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("uploaded_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    Column("deleted_at", DateTime(timezone=True)),
)

file_schemas = Table(
    "file_schemas",
    metadata,
    Column("id", Text, primary_key=True),
    Column("file_id", Text, nullable=False),
    Column("request_id", Text, nullable=False),
    Column("table_ord", Integer, nullable=False),
    Column("table_label", Text),
    Column("version", Integer, nullable=False),
    Column("fields", JSONB, nullable=False),
    Column("original_fields", JSONB, nullable=False),
    Column("shape_hash", Text, nullable=False),
    Column("edited_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

file_schema_results = Table(
    "file_schema_results",
    metadata,
    Column("file_schema_id", Text, primary_key=True),
    Column("file_id", Text, nullable=False),
    Column("request_id", Text, nullable=False),
    Column("stage", _enum(*TABLE_STAGE, name="table_stage"), nullable=False),
    Column("row_count", Integer, nullable=False),
    Column("field_count", Integer),
    Column("to_check_count", Integer, nullable=False),
    Column("progress_unit", Text),
    Column("progress_at", Integer),
    Column("progress_of", Integer),
    Column("failure_class", _enum(*FAILURE_CLASS, name="failure_class")),
    Column("failure_detail", Text),
    Column("started_at", DateTime(timezone=True)),
    Column("completed_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)

file_events = Table(
    "file_events",
    metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("request_id", Text, nullable=False),
    Column("file_id", Text),
    Column("user_id", Text, nullable=False),
    Column("request_trace_id", Text),
    Column("event_type", Text, nullable=False),
    Column("message", Text),
    Column("metadata", JSONB),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

request_outbox = Table(
    "request_outbox",
    metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("request_id", Text, nullable=False),
    Column("file_id", Text),
    Column("topic", Text, nullable=False),
    Column("payload", JSONB, nullable=False),
    Column("status", _enum(*OUTBOX_STATUS, name="outbox_status"), nullable=False),
    Column("attempts", Integer, nullable=False),
    Column("next_attempt_at", DateTime(timezone=True), nullable=False),
    Column("last_error", Text),
    Column("published_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)


# ------------------------------------------------------------------ events

class EventType:
    """`file_events.event_type` values, from §12."""

    REQUEST_CREATED = "REQUEST_CREATED"
    UPLOAD_INITIALIZED = "UPLOAD_INITIALIZED"
    UPLOAD_CONFIRMED = "UPLOAD_CONFIRMED"
    ZIP_EXPANDED = "ZIP_EXPANDED"
    INSPECT_STARTED = "INSPECT_STARTED"
    SCHEMA_WRITTEN = "SCHEMA_WRITTEN"
    SCHEMA_UPDATED = "SCHEMA_UPDATED"
    CONVERT_REQUESTED = "CONVERT_REQUESTED"
    CONVERT_STARTED = "CONVERT_STARTED"
    OUTPUT_WRITTEN = "OUTPUT_WRITTEN"
    FILE_COMPLETED = "FILE_COMPLETED"
    FILE_FAILED = "FILE_FAILED"
    FILE_RECLAIMED = "FILE_RECLAIMED"
    REQUEST_PAUSED = "REQUEST_PAUSED"
    REQUEST_RESUMED = "REQUEST_RESUMED"
    REQUEST_COMPLETED = "REQUEST_COMPLETED"
