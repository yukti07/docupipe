"""The scheduled sweep — the recovery path (§24.3, §31.2).

Cloud Scheduler calls this every minute. It is the only thing that recovers:

  * an outbox row whose inline publish failed
  * a file whose worker died holding the lease
  * a request parked on a limit whose resume time has passed

None of those produce a Pub/Sub message of their own, so without the timer
they wait for a coincidence. A system with a broken sweep looks completely
healthy right up until the first failure it was supposed to catch.
"""

from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.engine import Connection

from . import db, events, outbox
from .config import Config, get_config
from .failures import FailureClass
from .leases import RECLAIM_TARGET
from .models import EventType
from .publisher import get_publisher

log = logging.getLogger(__name__)


def run(cfg: Config | None = None) -> dict:
    cfg = cfg or get_config()
    publisher = get_publisher(cfg)

    with db.transaction() as conn:
        reclaimed = _reclaim_expired(conn, cfg)
        exhausted = _fail_exhausted(conn, cfg)
        resumed = _resume_paused(conn)
        relayed = outbox.relay(conn, cfg, publisher)

    report = {
        "reclaimed": reclaimed,
        "exhausted": exhausted,
        "resumed": resumed,
        **relayed,
    }

    if any(v for k, v in report.items() if k != "claimed"):
        log.info("sweep did work", extra=report)
    return report


def _reclaim_expired(conn: Connection, cfg: Config) -> int:
    """Put files whose lease expired back in the queue.

    A lease expiring is only useful if something notices. A file can reach a
    state where no message will ever be redelivered — it was acked before the
    crash, or the dead-letter policy already fired — so this is the only path
    back for it.

    The reclaim goes through the OUTBOX rather than publishing directly, so
    there remains exactly one way a file gets queued.
    """
    rows = conn.execute(
        text(
            """
            UPDATE files
               SET stage = CASE stage
                             WHEN 'INSPECTING' THEN 'UPLOADED'::file_stage
                             ELSE 'CONVERTING'::file_stage
                           END,
                   claimed_by    = NULL,
                   claimed_until = NULL,
                   updated_at    = now()
             WHERE stage IN ('INSPECTING', 'CONVERTING')
               AND claimed_until IS NOT NULL
               AND claimed_until < now()
               AND attempts < max_attempts
            RETURNING id, request_id, user_id, stage, attempts
            """
        )
    ).mappings().all()

    for row in rows:
        outbox.enqueue(
            conn,
            request_id=row["request_id"],
            file_id=row["id"],
            topic=cfg.topic_for_stage(row["stage"]),
            payload={"fileId": row["id"]},
        )
        events.record(
            conn,
            request_id=row["request_id"],
            user_id=row["user_id"],
            file_id=row["id"],
            event_type=EventType.FILE_RECLAIMED,
            message="Lease expired; returned to the queue.",
            metadata={"stage": row["stage"], "attempts": row["attempts"]},
        )
        log.warning(
            "reclaimed file with expired lease",
            extra={"fileId": row["id"], "stage": row["stage"]},
        )

    return len(rows)


def _fail_exhausted(conn: Connection, cfg: Config) -> int:
    """Give up on files that have burned their attempts.

    Without this they would be reclaimed forever, which looks like progress
    and is not.
    """
    rows = conn.execute(
        text(
            """
            UPDATE files
               SET stage          = 'FAILED',
                   claimed_by     = NULL,
                   claimed_until  = NULL,
                   failure_class  = 'max_attempts',
                   failure_detail = 'Stopped after repeated failures.',
                   updated_at     = now()
             WHERE stage IN ('INSPECTING', 'CONVERTING')
               AND claimed_until IS NOT NULL
               AND claimed_until < now()
               AND attempts >= max_attempts
            RETURNING id, request_id, user_id
            """
        )
    ).mappings().all()

    for row in rows:
        conn.execute(
            text(
                """
                UPDATE file_schema_results
                   SET stage          = 'FAILED',
                       failure_class  = 'max_attempts',
                       completed_at   = now(),
                       updated_at     = now()
                 WHERE file_id = :file_id AND stage <> 'DONE'
                """
            ),
            {"file_id": row["id"]},
        )
        events.record(
            conn,
            request_id=row["request_id"],
            user_id=row["user_id"],
            file_id=row["id"],
            event_type=EventType.FILE_FAILED,
            metadata={"failureClass": FailureClass.MAX_ATTEMPTS.value},
        )

    return len(rows)


def _resume_paused(conn: Connection) -> int:
    """Un-pause requests whose resume time has passed.

    Nobody is uploading anything at 14:32, so without the timer a parked
    request waits for a coincidence.
    """
    rows = conn.execute(
        text(
            """
            UPDATE requests
               SET status       = CASE WHEN converted_at IS NOT NULL
                                       THEN 'CONVERTING'::request_status
                                       ELSE 'COLLECTING'::request_status END,
                   paused_until = NULL,
                   updated_at   = now()
             WHERE status = 'PAUSED'
               AND paused_until IS NOT NULL
               AND paused_until <= now()
            RETURNING id, user_id
            """
        )
    ).mappings().all()

    for row in rows:
        events.record(
            conn,
            request_id=row["id"],
            user_id=row["user_id"],
            event_type=EventType.REQUEST_RESUMED,
            message="Allowance reset; picking up where it left off.",
        )

    return len(rows)
