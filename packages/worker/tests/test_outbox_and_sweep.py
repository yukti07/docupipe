"""The outbox and the sweep — the recovery half of the system.

The point of these is the *failure* paths. A publish that works is not
interesting; a publish that fails and then recovers with no human involved is
the whole reason the table exists.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from src import outbox, sweep
from src.publisher import NullPublisher

from .conftest import get_file, seed_file, seed_request

pytestmark = pytest.mark.usefixtures("engine")


class BrokenPublisher:
    """Fails every time, the way a revoked IAM binding would."""

    def __init__(self, message="publish refused"):
        self.message = message
        self.calls = 0

    def publish(self, topic, payload, attributes):
        self.calls += 1
        raise RuntimeError(self.message)


def _outbox_rows(engine):
    with engine.connect() as conn:
        return [
            dict(r)
            for r in conn.execute(
                text("SELECT * FROM request_outbox ORDER BY id")
            ).mappings()
        ]


def test_enqueue_writes_a_pending_row(engine, inspect_cfg):
    seed_request(engine)
    with engine.begin() as conn:
        outbox.enqueue(
            conn,
            request_id="req_test_0001",
            topic="file-uploaded",
            payload={"fileId": "file_a"},
        )

    rows = _outbox_rows(engine)
    assert len(rows) == 1
    assert rows[0]["status"] == "PENDING"
    assert rows[0]["payload"] == {"fileId": "file_a"}


def test_relay_publishes_and_marks_published(engine, inspect_cfg):
    seed_file(engine, file_id="file_a")
    with engine.begin() as conn:
        outbox.enqueue(
            conn, request_id="req_test_0001", file_id="file_a",
            topic="file-uploaded", payload={"fileId": "file_a"},
        )

    pub = NullPublisher()
    with engine.begin() as conn:
        report = outbox.relay(conn, inspect_cfg, pub)

    assert report["published"] == 1
    assert len(pub.published) == 1
    topic, payload, attributes = pub.published[0]
    assert topic == "file-uploaded"
    assert payload == {"fileId": "file_a"}
    assert attributes["fileId"] == "file_a"
    assert _outbox_rows(engine)[0]["status"] == "PUBLISHED"


def test_a_failed_publish_leaves_the_row_pending_and_does_not_fail_the_file(
    engine, inspect_cfg
):
    """The API must still have returned success. A transient Pub/Sub error is
    retryable, and failing the file terminally would throw away work the user
    asked for with no route back."""
    seed_file(engine, file_id="file_b")
    with engine.begin() as conn:
        outbox.enqueue(
            conn, request_id="req_test_0001", file_id="file_b",
            topic="file-uploaded", payload={"fileId": "file_b"},
        )

    with engine.begin() as conn:
        report = outbox.relay(conn, inspect_cfg, BrokenPublisher())

    assert report["retrying"] == 1
    row = _outbox_rows(engine)[0]
    assert row["status"] == "PENDING"
    assert row["attempts"] == 1
    assert row["last_error"]
    assert get_file(engine, "file_b")["stage"] != "FAILED"


def test_recovery_needs_no_client_action(engine, inspect_cfg):
    seed_file(engine, file_id="file_c")
    with engine.begin() as conn:
        outbox.enqueue(
            conn, request_id="req_test_0001", file_id="file_c",
            topic="file-uploaded", payload={"fileId": "file_c"},
        )

    with engine.begin() as conn:
        outbox.relay(conn, inspect_cfg, BrokenPublisher())

    # The backoff pushed next_attempt_at out; pull it back the way the clock
    # would, then sweep again with a working publisher.
    with engine.begin() as conn:
        conn.execute(text("UPDATE request_outbox SET next_attempt_at = now()"))

    pub = NullPublisher()
    with engine.begin() as conn:
        report = outbox.relay(conn, inspect_cfg, pub)

    assert report["published"] == 1
    assert _outbox_rows(engine)[0]["status"] == "PUBLISHED"


def test_give_up_after_max_attempts_and_fail_the_file(engine, inspect_cfg):
    seed_file(engine, file_id="file_d")
    with engine.begin() as conn:
        outbox.enqueue(
            conn, request_id="req_test_0001", file_id="file_d",
            topic="file-uploaded", payload={"fileId": "file_d"},
        )
        conn.execute(
            text("UPDATE request_outbox SET attempts = :n"),
            {"n": inspect_cfg.outbox_max_attempts},
        )

    with engine.begin() as conn:
        report = outbox.relay(conn, inspect_cfg, BrokenPublisher())

    assert report["dead"] == 1
    assert _outbox_rows(engine)[0]["status"] == "DEAD"
    failed = get_file(engine, "file_d")
    assert failed["stage"] == "FAILED"
    assert failed["failure_class"] == "internal"


def test_backoff_stops_a_tight_retry_loop(engine, inspect_cfg):
    seed_file(engine, file_id="file_e")
    with engine.begin() as conn:
        outbox.enqueue(
            conn, request_id="req_test_0001", file_id="file_e",
            topic="file-uploaded", payload={"fileId": "file_e"},
        )

    broken = BrokenPublisher()
    with engine.begin() as conn:
        outbox.relay(conn, inspect_cfg, broken)
    # Immediately again: the row is not due, so it must not be attempted.
    with engine.begin() as conn:
        report = outbox.relay(conn, inspect_cfg, broken)

    assert report["claimed"] == 0
    assert broken.calls == 1


# ------------------------------------------------------------------ sweep


def test_sweep_reclaims_a_dead_workers_file(engine, inspect_cfg, null_publisher):
    seed_file(
        engine,
        file_id="file_stuck",
        stage="INSPECTING",
        claimed_by="a-worker-that-died",
        claimed_until_sql="now() - interval '5 minutes'",
    )

    report = sweep.run(inspect_cfg)

    assert report["reclaimed"] == 1
    row = get_file(engine, "file_stuck")
    assert row["stage"] == "UPLOADED"
    assert row["claimed_by"] is None
    # Re-queued through the outbox, not published directly — there remains
    # exactly one way a file gets queued.
    assert report["published"] == 1
    assert null_publisher.published[0][1] == {"fileId": "file_stuck"}


def test_sweep_sends_a_convert_file_back_to_the_convert_topic(
    engine, convert_cfg, null_publisher
):
    seed_file(
        engine,
        file_id="file_conv",
        stage="CONVERTING",
        claimed_by="dead",
        claimed_until_sql="now() - interval '5 minutes'",
    )

    sweep.run(convert_cfg)

    topic, payload, _ = null_publisher.published[0]
    assert topic == "convert-requested"
    assert payload == {"fileId": "file_conv"}


def test_sweep_gives_up_on_an_exhausted_file(engine, inspect_cfg, null_publisher):
    seed_file(
        engine,
        file_id="file_done_for",
        stage="INSPECTING",
        attempts=5,
        max_attempts=5,
        claimed_by="dead",
        claimed_until_sql="now() - interval '5 minutes'",
    )

    report = sweep.run(inspect_cfg)

    assert report["exhausted"] == 1
    assert report["reclaimed"] == 0
    row = get_file(engine, "file_done_for")
    assert row["stage"] == "FAILED"
    assert row["failure_class"] == "max_attempts"


def test_sweep_leaves_a_healthy_lease_alone(engine, inspect_cfg, null_publisher):
    seed_file(
        engine,
        file_id="file_busy",
        stage="INSPECTING",
        claimed_by="a-worker-still-working",
        claimed_until_sql="now() + interval '10 minutes'",
    )

    report = sweep.run(inspect_cfg)

    assert report["reclaimed"] == 0
    assert get_file(engine, "file_busy")["claimed_by"] == "a-worker-still-working"


def test_sweep_resumes_a_paused_request(engine, inspect_cfg, null_publisher):
    seed_request(engine, request_id="req_paused", status="COLLECTING")
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE requests SET status='PAUSED', "
                "paused_until = now() - interval '1 minute' WHERE id='req_paused'"
            )
        )

    report = sweep.run(inspect_cfg)

    assert report["resumed"] == 1
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT status, paused_until FROM requests WHERE id='req_paused'")
        ).mappings().one()
    assert row["status"] == "COLLECTING"
    assert row["paused_until"] is None


def test_sweep_does_not_resume_before_the_time(engine, inspect_cfg, null_publisher):
    seed_request(engine, request_id="req_still_paused")
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE requests SET status='PAUSED', "
                "paused_until = now() + interval '1 hour' WHERE id='req_still_paused'"
            )
        )

    assert sweep.run(inspect_cfg)["resumed"] == 0


def test_sweep_is_a_quiet_no_op_when_there_is_nothing_to_do(
    engine, inspect_cfg, null_publisher
):
    report = sweep.run(inspect_cfg)
    assert report == {
        "reclaimed": 0,
        "exhausted": 0,
        "resumed": 0,
        "claimed": 0,
        "published": 0,
        "retrying": 0,
        "dead": 0,
    }
