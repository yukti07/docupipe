"""Test fixtures.

The queue tests run against a REAL PostgreSQL, because `FOR UPDATE SKIP
LOCKED` and the conditional-UPDATE claim are database behaviours, not
application logic — a mock would test our belief about PostgreSQL rather than
PostgreSQL.

Two ways to get one, tried in order:

  1. TEST_DATABASE_URL, if you already have a database (CI, or compose)
  2. testcontainers, which starts one

If neither is available the database tests skip with a reason rather than
failing, so `pytest` still runs the pure-logic tests on a machine with no
Docker.
"""

from __future__ import annotations

import os
import secrets
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from src import db as db_module
from src import publisher as publisher_module
from src import storage as storage_module
from src.config import Config, ServiceRole, StorageBackend

MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "db"
    / "prisma"
    / "migrations"
    / "20260915000000_init"
    / "migration.sql"
)


def _start_container():
    try:
        from testcontainers.postgres import PostgresContainer
    except ImportError:
        return None
    try:
        container = PostgresContainer("postgres:16-alpine")
        container.start()
        return container
    except Exception:  # noqa: BLE001 - no docker, or it refused
        return None


@pytest.fixture(scope="session")
def database_url():
    url = os.environ.get("TEST_DATABASE_URL")
    if url:
        yield url
        return

    container = _start_container()
    if container is None:
        pytest.skip(
            "No database. Set TEST_DATABASE_URL, or run Docker so testcontainers "
            "can start one."
        )
    try:
        yield container.get_connection_url().replace(
            "postgresql+psycopg2://", "postgresql+psycopg://"
        )
    finally:
        container.stop()


@pytest.fixture(scope="session")
def migrated_engine(database_url):
    """Apply the real migration — the same file Prisma applies in production.

    Not `metadata.create_all()`: that would test a schema this package
    invented, and would silently miss every CHECK and partial index, which are
    exactly the things worth testing.
    """
    engine = create_engine(database_url, future=True)
    sql = MIGRATION.read_text(encoding="utf-8")
    with engine.begin() as conn:
        # Start from nothing every session. Without this the fixture only works
        # against a database nobody has used, and the second run fails on
        # "type request_status already exists" — which looks like a migration
        # bug and is really a fixture that assumed a clean slate.
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
        conn.execute(text(sql))
    yield engine
    engine.dispose()


@pytest.fixture()
def engine(migrated_engine):
    """A clean database per test."""
    with migrated_engine.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE request_outbox, file_events, file_schema_results, "
                "file_schemas, files, requests, user_allowance, users "
                "RESTART IDENTITY CASCADE"
            )
        )
    db_module.set_engine(migrated_engine)
    yield migrated_engine
    db_module.set_engine(None)


@pytest.fixture()
def tmp_storage(tmp_path):
    store = storage_module.LocalStorage(str(tmp_path / "bucket"))
    storage_module.set_storage(store)
    yield store
    storage_module.set_storage(None)


@pytest.fixture()
def null_publisher():
    pub = publisher_module.NullPublisher()
    publisher_module.set_publisher(pub)
    yield pub
    publisher_module.set_publisher(None)


def make_config(role: ServiceRole = ServiceRole.INSPECT, **overrides) -> Config:
    base = dict(
        role=role,
        instance_id=f"{role.value}:test-{secrets.token_hex(3)}",
        database_url="",
        instance_connection_name="",
        db_user="",
        db_password="",
        db_name="",
        db_pool_size=2,
        storage_backend=StorageBackend.LOCAL,
        bucket="test-bucket",
        local_storage_root="/tmp/quarry-test",
        project_id="test-project",
        topic_file_uploaded="file-uploaded",
        topic_convert_requested="convert-requested",
        pubsub_delivery="push",
        subscription_file_uploaded="file-uploaded-local",
        subscription_convert_requested="convert-requested-local",
        lease_seconds=600,
        max_attempts=5,
        outbox_max_attempts=10,
        outbox_batch_size=100,
        reap_batch_size=100,
        log_level="WARNING",
        version="test",
    )
    base.update(overrides)
    return Config(**base)


@pytest.fixture()
def inspect_cfg():
    return make_config(ServiceRole.INSPECT)


@pytest.fixture()
def convert_cfg():
    return make_config(ServiceRole.CONVERT)


# ----------------------------------------------------------------- seeding

USER_ID = "usr_" + secrets.token_hex(16)
REQUEST_ID = "req_test_0001"


def seed_request(engine, *, user_id=USER_ID, request_id=REQUEST_ID, status="COLLECTING"):
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, created_at, updated_at, last_seen_at) "
                "VALUES (:id, now(), now(), now()) ON CONFLICT (id) DO NOTHING"
            ),
            {"id": user_id},
        )
        conn.execute(
            text(
                "INSERT INTO requests (id, user_id, status, file_count, "
                "created_at, updated_at) "
                "VALUES (:id, :user_id, CAST(:status AS request_status), 0, now(), now()) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"id": request_id, "user_id": user_id, "status": status},
        )
    return user_id, request_id


def seed_file(
    engine,
    *,
    file_id: str,
    stage: str = "UPLOADED",
    user_id=USER_ID,
    request_id=REQUEST_ID,
    filename: str = "invoice-1043.pdf",
    object_key: str | None = None,
    attempts: int = 0,
    max_attempts: int = 5,
    claimed_by: str | None = None,
    claimed_until_sql: str = "NULL",
    content_type: str | None = "application/pdf",
):
    seed_request(engine, user_id=user_id, request_id=request_id)
    key = object_key if object_key is not None else f"requests/{request_id}/input/{file_id}-{filename}"
    with engine.begin() as conn:
        conn.execute(
            text(
                f"""
                INSERT INTO files
                  (id, request_id, user_id, original_filename, content_type,
                   bucket, object_key, stage, attempts, max_attempts,
                   claimed_by, claimed_until, created_at, updated_at)
                VALUES
                  (:id, :request_id, :user_id, :filename, :content_type,
                   'test-bucket', :object_key, CAST(:stage AS file_stage),
                   :attempts, :max_attempts, :claimed_by, {claimed_until_sql},
                   now(), now())
                """
            ),
            {
                "id": file_id,
                "request_id": request_id,
                "user_id": user_id,
                "filename": filename,
                "content_type": content_type,
                "object_key": key,
                "stage": stage,
                "attempts": attempts,
                "max_attempts": max_attempts,
                "claimed_by": claimed_by,
            },
        )
    return key


def get_file(engine, file_id: str) -> dict:
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT * FROM files WHERE id = :id"), {"id": file_id}
        ).mappings().first()
    return dict(row) if row else {}


def seed_schema(
    engine,
    *,
    file_id: str,
    schema_id: str | None = None,
    request_id=REQUEST_ID,
    table_ord: int = 0,
):
    """Give a file a schema and a result row, as the inspect worker would.

    A file only reaches CONVERTING by way of SCHEMA_READY, so a convert test
    that seeds the stage directly has to seed these too or it is testing a
    state the real pipeline cannot produce.
    """
    import json

    from src.shapes import make_field, shape_hash

    sid = schema_id or f"sch_{file_id}_{table_ord}"
    fields = [make_field("column_a"), make_field("column_b", type_="number")]
    payload = json.dumps(fields)

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO file_schemas
                  (id, file_id, request_id, table_ord, table_label, version,
                   fields, original_fields, shape_hash, created_at)
                VALUES
                  (:id, :file_id, :request_id, :ord, 'Table 1', 1,
                   CAST(:fields AS jsonb), CAST(:fields AS jsonb), :hash, now())
                ON CONFLICT (file_id, table_ord) DO NOTHING
                """
            ),
            {
                "id": sid,
                "file_id": file_id,
                "request_id": request_id,
                "ord": table_ord,
                "fields": payload,
                "hash": shape_hash(fields),
            },
        )
        conn.execute(
            text(
                """
                INSERT INTO file_schema_results
                  (file_schema_id, file_id, request_id, stage,
                   row_count, field_count, to_check_count, updated_at)
                VALUES (:id, :file_id, :request_id, 'QUEUED', 0, 2, 0, now())
                ON CONFLICT (file_schema_id) DO NOTHING
                """
            ),
            {"id": sid, "file_id": file_id, "request_id": request_id},
        )
    return sid

