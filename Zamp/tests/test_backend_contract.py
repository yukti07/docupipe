"""The worker and the backend must describe the same database.

This is the guard against the failure mode that is invisible until production:
the worker writing a column the backend does not have, an enum value the
Postgres type rejects, or a hash the backend computes differently. Every one of
those looks like working code and a passing unit test.

So this reads the BACKEND'S OWN FILES — the Prisma migration, the TypeScript
types, the client-side hash — and compares them to what the worker declares. No
database and no network: it is text, so it runs anywhere and fails fast.

Skipped wholesale when the backend package is not checked out beside this repo.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from zamp_shared.failures import FAILURE_CLASSES, failure_class
from zamp_shared.repositories import (
    FailureClass, FileStage, FileSchemaResultRow, FileSchemaRow, FileRow, FileEventRow,
    OutboxStatus, RequestOutboxRow, TableStage, shape_hash, to_backend_fields,
)
from zamp_shared.domain import Schema, SchemaField

#: The backend lives one level up when this repo is checked out inside it.
BACKEND = Path(__file__).resolve().parents[2]
MIGRATION = BACKEND / "packages/db/prisma/migrations/20260915000000_init/migration.sql"
TYPES_TS = BACKEND / "packages/web/src/lib/api/types.ts"

pytestmark = pytest.mark.skipif(not MIGRATION.exists(), reason="backend package not checked out beside this one")


def _sql() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def _sql_enum(name: str) -> set[str]:
    body = re.search(rf'CREATE TYPE "{name}" AS ENUM\s*\((.*?)\);', _sql(), re.S)
    assert body, f"no {name} enum in the migration"
    return set(re.findall(r"'([a-zA-Z_]+)'", body.group(1)))


def _sql_columns(table: str) -> set[str]:
    body = re.search(rf'CREATE TABLE "{table}" \((.*?)\n\);', _sql(), re.S)
    assert body, f"no {table} table in the migration"
    return set(re.findall(r'^\s*"([a-z_]+)"', body.group(1), re.M))


# ------------------------------------------------------------------ enums

@pytest.mark.parametrize("sql_name, column_type", [
    ("file_stage", FileStage),
    ("table_stage", TableStage),
    ("outbox_status", OutboxStatus),
    ("failure_class", FailureClass),
])
def test_worker_enum_matches_the_postgres_type(sql_name: str, column_type) -> None:
    """A value outside the type is `invalid input value for enum`, which aborts
    the transaction — and because the write happens inside an exception
    handler, it replaces the real error with a database one."""
    assert set(column_type.enums) == _sql_enum(sql_name)


def test_failure_class_table_matches_the_postgres_type() -> None:
    assert FAILURE_CLASSES == _sql_enum("failure_class")


def test_every_domain_error_code_maps_into_the_enum() -> None:
    """Including ones nobody has thought of. `failure_class` must never return
    something the column will reject."""
    codes = ["FILE_NOT_FOUND", "UNSUPPORTED_MIME_TYPE", "INVALID_INPUT", "INVALID_PUBSUB_MESSAGE",
             "SCHEMA_NOT_FOUND", "SCHEMA_NOT_APPROVED", "INVALID_SCHEMA_STATE", "PROCESSING_RUN_NOT_FOUND",
             "INVALID_PROCESSING_REQUEST", "MAX_RECORDS_EXCEEDED", "TYPE_COERCION_FAILED", "EXTRACT_EMPTY",
             "EMPTY_FILE", "INVALID_FILE_ID", "DOMAIN_ERROR", "PROCESSING_FAILED", "", None,
             "SOMETHING_NOBODY_HAS_WRITTEN_YET"]
    for code in codes:
        assert failure_class(code) in FAILURE_CLASSES, code


# ---------------------------------------------------------------- columns

@pytest.mark.parametrize("model, table", [
    (FileRow, "files"),
    (FileSchemaRow, "file_schemas"),
    (FileSchemaResultRow, "file_schema_results"),
    (FileEventRow, "file_events"),
    (RequestOutboxRow, "request_outbox"),
])
def test_worker_only_declares_columns_the_backend_has(model, table: str) -> None:
    declared = {column.name for column in model.__table__.columns}
    actual = _sql_columns(table)
    assert declared <= actual, f"{table}: worker declares columns the backend does not have: {sorted(declared - actual)}"


def test_worker_reads_every_file_column_it_depends_on() -> None:
    """Named explicitly rather than derived, so removing one on either side is
    a test failure and not a silent None."""
    required = {"id", "request_id", "user_id", "original_filename", "content_type", "detected_content_type",
                "size_bytes", "bucket", "object_key", "stage", "attempts", "max_attempts",
                "claimed_by", "claimed_until", "failure_class", "failure_detail"}
    assert required <= _sql_columns("files")


def test_outbox_row_shape_is_what_the_backend_writes() -> None:
    """The backend INSERTs these and the worker's relay reads them. A column
    added on one side and not the other breaks recovery, which is the one
    path nobody exercises until it is needed."""
    assert {"request_id", "file_id", "topic", "payload", "status", "attempts",
            "next_attempt_at", "last_error", "published_at"} <= _sql_columns("request_outbox")


# ------------------------------------------------------------ field shape

def _field_types_from_types_ts() -> set[str]:
    body = re.search(r"export const FIELD_TYPES: readonly FieldType\[\] = \[(.*?)\]", TYPES_TS.read_text(encoding="utf-8"), re.S)
    assert body, "no FIELD_TYPES in types.ts"
    return set(re.findall(r'"([a-z]+)"', body.group(1)))


@pytest.mark.skipif(not TYPES_TS.exists(), reason="web package not present")
def test_detected_field_types_are_all_types_the_ui_can_render() -> None:
    """`to_backend_fields` normalizes the worker's canonical types onto the
    backend's six. Anything that slips through is a type the schema editor has
    no control for and `updateSchema` rejects outright."""
    every_worker_type = ["text", "number", "date", "currency", "boolean", "list",
                         "string", "integer", "datetime", "array", "object", "null"]
    allowed = _field_types_from_types_ts()

    for worker_type in every_worker_type:
        kwargs = {"name": "f", "type": worker_type}
        if worker_type == "array": kwargs["item_type"] = "string"
        if worker_type == "object": kwargs["fields"] = [SchemaField(name="inner", type="string")]
        emitted = to_backend_fields(Schema(name="records", fields=[SchemaField(**kwargs)]))[0]
        assert emitted["type"] in allowed, f"{worker_type} -> {emitted['type']} is not a FieldType"


@pytest.mark.skipif(not TYPES_TS.exists(), reason="web package not present")
def test_every_currency_the_editor_offers_is_one_the_coercer_can_read(processor) -> None:
    """The picker and the coercer share one list, in two languages.

    A code the schema editor offers that the coercer does not know leaves its
    symbol sitting in front of the number. The amount stops parsing, and every
    cell in the column comes back as the raw string it arrived as — silently,
    and for the whole column.
    """
    body = re.search(r"export const CURRENCY_CODES: readonly CurrencyCode\[\] = \[(.*?)\]",
                     TYPES_TS.read_text(encoding="utf-8"), re.S)
    assert body, "no CURRENCY_CODES in types.ts"
    offered = re.findall(r'"([A-Z]{3})"', body.group(1))
    assert offered, "CURRENCY_CODES is empty"

    coerce = processor.TypeCoercer().coerce
    for code in offered:
        assert coerce(f"{code} 1,500", "currency") == 1500.0, f"{code} is offered but not read"


@pytest.mark.skipif(not TYPES_TS.exists(), reason="web package not present")
def test_detected_fields_carry_an_origin_the_ui_understands() -> None:
    fields = to_backend_fields(Schema(name="records", fields=[SchemaField(name="id", type="integer")]))
    assert fields[0]["origin"] == "detected"
    assert {"key", "label", "type", "origin"} <= set(fields[0])


# -------------------------------------------------------------- the hash

def test_shape_hash_matches_the_backend_implementation() -> None:
    """Vectors generated from packages/web/src/lib/schema.ts itself.

    `shape_hash` decides which tables group together, what "apply to all"
    reaches, and whether `updateSchema` will accept a batch at all. A worker
    that hashes differently produces a schema screen where nothing groups and
    every multi-file save is rejected.
    """
    assert shape_hash([{"key": "invoice_id", "type": "text"}, {"key": "amount", "type": "number"}]) == "ec73a3e2"
    # Order-independent, like the backend's.
    assert shape_hash([{"key": "amount", "type": "number"}, {"key": "invoice_id", "type": "text"}]) == "ec73a3e2"
    assert shape_hash([{"key": "id", "type": "number"}, {"key": "name", "type": "text"},
                       {"key": "active", "type": "boolean"}]) == "a127e325"
    assert shape_hash([]) == "811c9dc5"


def test_shape_hash_ignores_everything_except_key_and_type() -> None:
    """Descriptions and aliases are worker-side detail. Hashing them splits two
    files that read identically into two groups."""
    plain = [{"key": "id", "type": "number"}]
    decorated = [{"key": "id", "type": "number", "description": "the id", "aliases": ["ID"], "required": True}]
    assert shape_hash(plain) == shape_hash(decorated)
