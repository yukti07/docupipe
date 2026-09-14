"""Claiming a file, holding the lease, and letting it go (§31).

Pub/Sub delivers at least once and the outbox publishes at least once on top
of that, so duplicate delivery is the normal case rather than the edge case.

A status check alone does not cover the case that actually hurts: a worker
that died AFTER marking a file in progress. That file is in progress forever,
and a status check tells the next delivery nothing about whether anyone is
still working on it.

The fix is a lease, and it is one conditional UPDATE.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum

from sqlalchemy import text
from sqlalchemy.engine import Connection

from .config import Config, ServiceRole
from .failures import FailureClass

log = logging.getLogger(__name__)


class ClaimOutcome(str, Enum):
    """What happened, and therefore what to answer Pub/Sub with.

    Returning 200 for an unprocessable message is deliberate: nacking a
    message that can never succeed just burns redeliveries until the
    dead-letter policy fires. Nack only when retrying later could plausibly
    work — which is exactly the live-lease case.
    """

    CLAIMED = "claimed"
    ALREADY_DONE = "already_done"       # 200 — ack, nothing to do
    TERMINAL = "terminal"               # 200 — ack, redelivery cannot help
    LEASE_HELD = "lease_held"           # 409 — nack, someone else has it
    EXHAUSTED = "exhausted"             # 200 — ack, and fail it
    NOT_FOUND = "not_found"             # 200 — ack, the row cannot appear later

    @property
    def http_status(self) -> int:
        return 409 if self is ClaimOutcome.LEASE_HELD else 200


@dataclass(frozen=True)
class ClaimResult:
    outcome: ClaimOutcome
    file: dict | None = None
    detail: str = ""

    @property
    def claimed(self) -> bool:
        return self.outcome is ClaimOutcome.CLAIMED


#: Which stages a role may claim from, and what it moves the file to.
#:
#: Convert is the odd one: /api/convert already set the file to CONVERTING in
#: its own transaction before publishing, so the convert worker claims a file
#: that is *already* at its target stage. The lease, not the stage, is what
#: says whether anyone holds it.
_TRANSITIONS: dict[ServiceRole, tuple[tuple[str, ...], str]] = {
    ServiceRole.INSPECT: (("UPLOADED", "INSPECTING"), "INSPECTING"),
    ServiceRole.CONVERT: (("CONVERTING",), "CONVERTING"),
}

#: Where the reaper sends a file whose lease expired, per stage it was found in.
RECLAIM_TARGET: dict[str, str] = {
    "INSPECTING": "UPLOADED",
    "CONVERTING": "CONVERTING",
}

_CLAIM_SQL = text(
    """
    UPDATE files
       SET stage         = CAST(:next_stage AS file_stage),
           claimed_by    = :instance_id,
           claimed_until = now() + make_interval(secs => :lease_seconds),
           attempts      = attempts + 1,
           updated_at    = now()
     WHERE id = :file_id
       AND stage::text = ANY(:claimable)
       AND (claimed_until IS NULL OR claimed_until < now())
       AND attempts < max_attempts
    RETURNING *
    """
)

_RENEW_SQL = text(
    """
    UPDATE files
       SET claimed_until = now() + make_interval(secs => :lease_seconds),
           updated_at    = now()
     WHERE id = :file_id
       AND claimed_by = :instance_id
    RETURNING claimed_until
    """
)


def claim(conn: Connection, cfg: Config, file_id: str) -> ClaimResult:
    """Take the file, or explain why not.

    One statement, so two concurrent deliveries cannot both win: PostgreSQL
    serialises the row update and exactly one of them gets a row back.
    """
    claimable, next_stage = _TRANSITIONS[cfg.role]

    row = conn.execute(
        _CLAIM_SQL,
        {
            "file_id": file_id,
            "next_stage": next_stage,
            "claimable": list(claimable),
            "instance_id": cfg.instance_id,
            "lease_seconds": cfg.lease_seconds,
        },
    ).mappings().first()

    if row is not None:
        return ClaimResult(ClaimOutcome.CLAIMED, dict(row))

    # Nothing claimed. Read the row and work out which of the five it is.
    current = conn.execute(
        text("SELECT * FROM files WHERE id = :file_id"), {"file_id": file_id}
    ).mappings().first()

    if current is None:
        return ClaimResult(ClaimOutcome.NOT_FOUND, None, f"no file {file_id}")

    current = dict(current)
    stage = current["stage"]

    if stage == "FAILED":
        return ClaimResult(ClaimOutcome.TERMINAL, current, "already failed")

    if current["attempts"] >= current["max_attempts"]:
        return ClaimResult(ClaimOutcome.EXHAUSTED, current, "attempts exhausted")

    # Past this role's window: inspect sees SCHEMA_READY or later, convert
    # sees COMPLETED. An earlier delivery finished the work.
    if stage not in claimable:
        return ClaimResult(ClaimOutcome.ALREADY_DONE, current, f"stage is {stage}")

    # In our window, so the only thing stopping us is a live lease.
    return ClaimResult(
        ClaimOutcome.LEASE_HELD,
        current,
        f"held by {current.get('claimed_by')} until {current.get('claimed_until')}",
    )


def renew(conn: Connection, cfg: Config, file_id: str) -> datetime | None:
    """Push the lease out while work is still running.

    The `claimed_by` predicate means a worker that has already lost its lease
    cannot take it back — it finds zero rows and stops renewing.
    """
    row = conn.execute(
        _RENEW_SQL,
        {
            "file_id": file_id,
            "instance_id": cfg.instance_id,
            "lease_seconds": cfg.lease_seconds,
        },
    ).first()
    return row[0] if row else None


def complete(conn: Connection, cfg: Config, file_id: str, next_stage: str) -> None:
    """Advance the stage and drop the lease, in one statement."""
    conn.execute(
        text(
            """
            UPDATE files
               SET stage         = CAST(:next_stage AS file_stage),
                   claimed_by    = NULL,
                   claimed_until = NULL,
                   failure_class = NULL,
                   failure_detail= NULL,
                   updated_at    = now()
             WHERE id = :file_id
               AND claimed_by = :instance_id
            """
        ),
        {
            "file_id": file_id,
            "next_stage": next_stage,
            "instance_id": cfg.instance_id,
        },
    )


def fail(
    conn: Connection,
    cfg: Config,
    file_id: str,
    failure_class: FailureClass,
    detail: str | None = None,
) -> None:
    """Mark the file failed and drop the lease.

    The database CHECK enforces that FAILED and a class travel together, so
    this cannot leave a row in a state the UI has no sentence for.
    """
    conn.execute(
        text(
            """
            UPDATE files
               SET stage          = 'FAILED',
                   claimed_by     = NULL,
                   claimed_until  = NULL,
                   failure_class  = CAST(:failure_class AS failure_class),
                   failure_detail = :detail,
                   updated_at     = now()
             WHERE id = :file_id
            """
        ),
        {
            "file_id": file_id,
            "failure_class": failure_class.value,
            "detail": (detail or "")[:2000] or None,
        },
    )


def release(conn: Connection, cfg: Config, file_id: str, back_to: str) -> None:
    """Put the file back where it was and drop the lease, without failing it.

    Used when a retryable failure still has attempts left: the file returns to
    the queue rather than becoming a dead end.
    """
    conn.execute(
        text(
            """
            UPDATE files
               SET stage         = CAST(:back_to AS file_stage),
                   claimed_by    = NULL,
                   claimed_until = NULL,
                   updated_at    = now()
             WHERE id = :file_id
               AND claimed_by = :instance_id
            """
        ),
        {"file_id": file_id, "back_to": back_to, "instance_id": cfg.instance_id},
    )


def lease_deadline(cfg: Config) -> datetime:
    return datetime.now(timezone.utc) + timedelta(seconds=cfg.lease_seconds)
