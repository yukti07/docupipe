"""Claiming, leasing and recovery — Test Module 6b.

These are the tests that cannot be written later, because by then the
behaviour is load-bearing and undiscovered.
"""

from __future__ import annotations

import concurrent.futures

import pytest
from sqlalchemy import text

from src import leases
from src.config import ServiceRole
from src.failures import FailureClass
from src.leases import ClaimOutcome

from .conftest import get_file, make_config, seed_file

pytestmark = pytest.mark.usefixtures("engine")


def test_claim_moves_uploaded_to_inspecting(engine, inspect_cfg):
    seed_file(engine, file_id="file_a", stage="UPLOADED")

    with engine.begin() as conn:
        result = leases.claim(conn, inspect_cfg, "file_a")

    assert result.outcome is ClaimOutcome.CLAIMED
    row = get_file(engine, "file_a")
    assert row["stage"] == "INSPECTING"
    assert row["claimed_by"] == inspect_cfg.instance_id
    assert row["claimed_until"] is not None
    assert row["attempts"] == 1


def test_convert_claims_a_file_already_at_its_target_stage(engine, convert_cfg):
    """/api/convert sets CONVERTING before publishing, so the worker claims a
    file that is already at its target stage. The lease, not the stage, is
    what says whether anyone holds it."""
    seed_file(engine, file_id="file_b", stage="CONVERTING")

    with engine.begin() as conn:
        result = leases.claim(conn, convert_cfg, "file_b")

    assert result.outcome is ClaimOutcome.CLAIMED
    assert get_file(engine, "file_b")["claimed_by"] == convert_cfg.instance_id


def test_second_delivery_of_a_live_lease_is_nacked(engine, inspect_cfg):
    seed_file(engine, file_id="file_c", stage="UPLOADED")
    other = make_config(ServiceRole.INSPECT)

    with engine.begin() as conn:
        first = leases.claim(conn, inspect_cfg, "file_c")
    with engine.begin() as conn:
        second = leases.claim(conn, other, "file_c")

    assert first.outcome is ClaimOutcome.CLAIMED
    assert second.outcome is ClaimOutcome.LEASE_HELD
    # 409 is the one case where retrying later could plausibly work.
    assert second.outcome.http_status == 409


def test_expired_lease_can_be_taken_over(engine, inspect_cfg):
    seed_file(
        engine,
        file_id="file_d",
        stage="INSPECTING",
        claimed_by="a-worker-that-died",
        claimed_until_sql="now() - interval '1 minute'",
    )

    with engine.begin() as conn:
        result = leases.claim(conn, inspect_cfg, "file_d")

    assert result.outcome is ClaimOutcome.CLAIMED
    assert get_file(engine, "file_d")["claimed_by"] == inspect_cfg.instance_id


def test_already_finished_file_is_acked_not_reprocessed(engine, inspect_cfg):
    seed_file(engine, file_id="file_e", stage="SCHEMA_READY")

    with engine.begin() as conn:
        result = leases.claim(conn, inspect_cfg, "file_e")

    assert result.outcome is ClaimOutcome.ALREADY_DONE
    assert result.outcome.http_status == 200


def test_failed_file_is_acked(engine, inspect_cfg):
    seed_file(engine, file_id="file_f", stage="UPLOADED")
    with engine.begin() as conn:
        leases.fail(conn, inspect_cfg, "file_f", FailureClass.FORMAT_LOCKED, "locked")

    with engine.begin() as conn:
        result = leases.claim(conn, inspect_cfg, "file_f")

    assert result.outcome is ClaimOutcome.TERMINAL
    assert result.outcome.http_status == 200


def test_unknown_file_is_acked(engine, inspect_cfg):
    """Redelivery cannot make the row appear, so nacking only burns attempts."""
    with engine.begin() as conn:
        result = leases.claim(conn, inspect_cfg, "file_does_not_exist")

    assert result.outcome is ClaimOutcome.NOT_FOUND
    assert result.outcome.http_status == 200


def test_exhausted_attempts_stop_the_claim(engine, inspect_cfg):
    seed_file(engine, file_id="file_g", stage="UPLOADED", attempts=5, max_attempts=5)

    with engine.begin() as conn:
        result = leases.claim(conn, inspect_cfg, "file_g")

    assert result.outcome is ClaimOutcome.EXHAUSTED


def test_concurrent_claims_produce_exactly_one_winner(engine, inspect_cfg):
    """The property that cannot be mocked: two workers racing for one row."""
    seed_file(engine, file_id="file_race", stage="UPLOADED")
    configs = [make_config(ServiceRole.INSPECT) for _ in range(8)]

    def attempt(cfg):
        with engine.begin() as conn:
            return leases.claim(conn, cfg, "file_race").outcome

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        outcomes = list(pool.map(attempt, configs))

    assert outcomes.count(ClaimOutcome.CLAIMED) == 1
    assert outcomes.count(ClaimOutcome.LEASE_HELD) == 7
    # One claim, so attempts incremented exactly once.
    assert get_file(engine, "file_race")["attempts"] == 1


def test_renewal_extends_the_lease(engine, inspect_cfg):
    seed_file(engine, file_id="file_h", stage="UPLOADED")
    with engine.begin() as conn:
        leases.claim(conn, inspect_cfg, "file_h")

    # Pull the lease in to a second from now, as a long job would find it.
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE files SET claimed_until = now() + interval '1 second' "
                 "WHERE id = 'file_h'")
        )
    nearly_expired = get_file(engine, "file_h")["claimed_until"]

    with engine.begin() as conn:
        renewed = leases.renew(conn, inspect_cfg, "file_h")

    assert renewed is not None
    assert get_file(engine, "file_h")["claimed_until"] > nearly_expired


def test_a_worker_that_lost_its_lease_cannot_renew(engine, inspect_cfg):
    seed_file(
        engine,
        file_id="file_i",
        stage="INSPECTING",
        claimed_by="somebody-else",
        claimed_until_sql="now() + interval '10 minutes'",
    )

    with engine.begin() as conn:
        assert leases.renew(conn, inspect_cfg, "file_i") is None


def test_failure_class_and_stage_are_enforced_together(engine, inspect_cfg):
    """The CHECK makes "every failure has a class" a database guarantee."""
    seed_file(engine, file_id="file_j", stage="UPLOADED")

    with pytest.raises(Exception):
        with engine.begin() as conn:
            conn.execute(
                text("UPDATE files SET stage = 'FAILED' WHERE id = 'file_j'")
            )


def test_completing_clears_the_lease_and_any_stale_failure(engine, inspect_cfg):
    seed_file(engine, file_id="file_k", stage="UPLOADED")
    with engine.begin() as conn:
        leases.claim(conn, inspect_cfg, "file_k")
        leases.complete(conn, inspect_cfg, "file_k", "SCHEMA_READY")

    row = get_file(engine, "file_k")
    assert row["stage"] == "SCHEMA_READY"
    assert row["claimed_by"] is None
    assert row["claimed_until"] is None
    assert row["failure_class"] is None
