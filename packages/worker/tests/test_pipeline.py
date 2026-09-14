"""End to end through the worker, with no broker and no cloud account.

The gate is what these are really testing: an inspected file must stop at
SCHEMA_READY and go no further on its own.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from src import pipeline
from src.leases import ClaimOutcome
from src.storage import output_key

from .conftest import get_file, seed_file, seed_schema

pytestmark = pytest.mark.usefixtures("engine")


def _schemas(engine, file_id):
    with engine.connect() as conn:
        return [
            dict(r)
            for r in conn.execute(
                text("SELECT * FROM file_schemas WHERE file_id = :f ORDER BY table_ord"),
                {"f": file_id},
            ).mappings()
        ]


def _results(engine, file_id):
    with engine.connect() as conn:
        return [
            dict(r)
            for r in conn.execute(
                text("SELECT * FROM file_schema_results WHERE file_id = :f"),
                {"f": file_id},
            ).mappings()
        ]


def test_inspect_writes_a_schema_and_stops_at_the_gate(
    engine, inspect_cfg, tmp_storage, null_publisher
):
    key = seed_file(engine, file_id="file_a", stage="UPLOADED", content_type="text/plain")
    tmp_storage.write(key, b"invoice,total\nA-1,10\n", content_type="text/plain")

    result = pipeline.handle("file_a", inspect_cfg)

    assert result.outcome is ClaimOutcome.CLAIMED
    row = get_file(engine, "file_a")
    assert row["stage"] == "SCHEMA_READY"
    assert row["claimed_by"] is None
    assert row["detected_content_type"] == "text/plain"

    schemas = _schemas(engine, "file_a")
    assert len(schemas) == 1
    assert schemas[0]["shape_hash"]
    assert schemas[0]["fields"] == schemas[0]["original_fields"]

    # The gate: nothing was converted, and no output object exists.
    assert not tmp_storage.stat(output_key("req_test_0001", "file_a")).exists


def test_inspect_seeds_a_result_row_per_table(
    engine, inspect_cfg, tmp_storage, null_publisher
):
    """The counts in the result poll must sum to the number of TABLES,
    including ones that have not started."""
    key = seed_file(engine, file_id="file_b", content_type="text/plain")
    tmp_storage.write(key, b"hello", content_type="text/plain")

    pipeline.handle("file_b", inspect_cfg)

    results = _results(engine, "file_b")
    assert len(results) == 1
    assert results[0]["stage"] == "QUEUED"
    assert results[0]["field_count"] == 3


def test_request_becomes_ready_when_every_file_has_settled(
    engine, inspect_cfg, tmp_storage, null_publisher
):
    for name in ("file_c1", "file_c2"):
        key = seed_file(engine, file_id=name, content_type="text/plain")
        tmp_storage.write(key, b"data", content_type="text/plain")

    pipeline.handle("file_c1", inspect_cfg)
    with engine.connect() as conn:
        mid = conn.execute(text("SELECT status FROM requests WHERE id='req_test_0001'")).scalar()
    assert mid == "COLLECTING"

    pipeline.handle("file_c2", inspect_cfg)
    with engine.connect() as conn:
        after = conn.execute(text("SELECT status FROM requests WHERE id='req_test_0001'")).scalar()
    assert after == "READY"


def test_a_failed_file_still_counts_as_settled(
    engine, inspect_cfg, tmp_storage, null_publisher
):
    """One unreadable file must not hold good ones hostage."""
    good = seed_file(engine, file_id="file_good", content_type="text/plain")
    tmp_storage.write(good, b"data", content_type="text/plain")
    # No object written for this one, so it fails acquisition.
    seed_file(engine, file_id="file_bad", content_type="text/plain")

    pipeline.handle("file_good", inspect_cfg)
    pipeline.handle("file_bad", inspect_cfg)

    bad = get_file(engine, "file_bad")
    # Retryable, so the first failure returns it to the queue rather than
    # failing it outright.
    assert bad["stage"] in ("UPLOADED", "FAILED")

    # Burn the remaining attempts.
    for _ in range(6):
        pipeline.handle("file_bad", inspect_cfg)

    bad = get_file(engine, "file_bad")
    assert bad["stage"] == "FAILED"
    assert bad["failure_class"] in ("acquisition", "max_attempts")

    with engine.connect() as conn:
        status = conn.execute(text("SELECT status FROM requests WHERE id='req_test_0001'")).scalar()
    assert status == "READY"


def test_convert_writes_the_output_with_the_users_filename(
    engine, convert_cfg, tmp_storage, null_publisher
):
    key = seed_file(
        engine,
        file_id="file_d",
        stage="CONVERTING",
        filename="invoice-1043.pdf",
        content_type="text/plain",
    )
    seed_schema(engine, file_id="file_d")
    tmp_storage.write(key, b"anything", content_type="text/plain")

    result = pipeline.handle("file_d", convert_cfg)

    assert result.outcome is ClaimOutcome.CLAIMED
    assert get_file(engine, "file_d")["stage"] == "COMPLETED"

    written = tmp_storage.read(output_key("req_test_0001", "file_d")).decode()
    # The name the user gave the file — not the object key, and not the
    # sanitised segment inside it.
    assert written == "Successfully processed invoice-1043.pdf\n"

    results = _results(engine, "file_d")
    assert results[0]["stage"] == "DONE"
    assert results[0]["completed_at"] is not None


def test_convert_is_idempotent_across_duplicate_delivery(
    engine, convert_cfg, tmp_storage, null_publisher
):
    key = seed_file(engine, file_id="file_e", stage="CONVERTING", content_type="text/plain")
    seed_schema(engine, file_id="file_e")
    tmp_storage.write(key, b"x", content_type="text/plain")

    first = pipeline.handle("file_e", convert_cfg)
    second = pipeline.handle("file_e", convert_cfg)

    assert first.outcome is ClaimOutcome.CLAIMED
    assert second.outcome is ClaimOutcome.ALREADY_DONE
    assert second.http_status == 200

    with engine.connect() as conn:
        written = conn.execute(
            text(
                "SELECT COUNT(*) FROM file_events "
                "WHERE file_id='file_e' AND event_type='OUTPUT_WRITTEN'"
            )
        ).scalar()
    assert written == 1


def test_empty_file_fails_with_a_class_and_a_sentence(
    engine, inspect_cfg, tmp_storage, null_publisher
):
    key = seed_file(engine, file_id="file_f", content_type="text/plain")
    tmp_storage.write(key, b"", content_type="text/plain")

    pipeline.handle("file_f", inspect_cfg)

    row = get_file(engine, "file_f")
    assert row["stage"] == "FAILED"
    assert row["failure_class"] == "empty_file"
    assert row["failure_detail"]


def test_a_lie_about_the_content_type_is_caught_by_the_bytes(
    engine, inspect_cfg, tmp_storage, null_publisher
):
    """The declared type is a client claim. This is the first point anything
    looks at the actual bytes."""
    key = seed_file(engine, file_id="file_g", content_type="application/pdf")
    tmp_storage.write(key, b"PK\x03\x04 not a pdf at all", content_type="application/pdf")

    pipeline.handle("file_g", inspect_cfg)

    row = get_file(engine, "file_g")
    assert row["stage"] == "FAILED"
    assert row["failure_class"] == "format_corrupt"


def test_docx_is_not_reported_as_corrupt_for_being_a_zip(
    engine, inspect_cfg, tmp_storage, null_publisher
):
    """Office formats are ZIP containers. Treating that as a lie would fail
    every .docx a user uploads."""
    key = seed_file(
        engine,
        file_id="file_h",
        content_type=(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ),
    )
    tmp_storage.write(key, b"PK\x03\x04" + b"\x00" * 64)

    pipeline.handle("file_h", inspect_cfg)

    assert get_file(engine, "file_h")["stage"] == "SCHEMA_READY"
