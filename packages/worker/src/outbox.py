"""The transactional outbox (§24).

Writing to PostgreSQL and publishing to Pub/Sub are two systems and cannot be
committed together. The outbox makes the database the only thing that has to
be right: a row committed as PENDING *is* the queue entry, and the relay's job
is to catch up with it.

At-least-once publishing is the accepted consequence — the inline attempt may
succeed and its acknowledgement be lost, so the relay publishes again. The
lease in §31 is what makes duplicate delivery harmless.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Protocol

from sqlalchemy import text
from sqlalchemy.engine import Connection

from .config import Config

log = logging.getLogger(__name__)


class Publisher(Protocol):
    """Anything that can put a message on a topic.

    A Protocol rather than the Pub/Sub client directly, so the relay is
    testable without a broker and `docker compose` needs no cloud account.
    """

    def publish(self, topic: str, payload: dict, attributes: dict[str, str]) -> str:
        ...


def enqueue(
    conn: Connection,
    *,
    request_id: str,
    topic: str,
    payload: dict[str, Any],
    file_id: str | None = None,
) -> int:
    """Write a PENDING outbox row.

    MUST be called inside the same transaction as the state change it
    announces. That is the whole point of the table — a row that is durably
    created but not durably queued is the failure this prevents.
    """
    row = conn.execute(
        text(
            """
            INSERT INTO request_outbox
                (request_id, file_id, topic, payload, status,
                 attempts, next_attempt_at, created_at, updated_at)
            VALUES
                (:request_id, :file_id, :topic, CAST(:payload AS jsonb), 'PENDING',
                 0, now(), now(), now())
            RETURNING id
            """
        ),
        {
            "request_id": request_id,
            "file_id": file_id,
            "topic": topic,
            "payload": json.dumps(payload),
        },
    ).first()
    return int(row[0])


_CLAIM_SQL = text(
    """
    UPDATE request_outbox
       SET attempts        = attempts + 1,
           next_attempt_at = now() + make_interval(
               secs => LEAST(3600, 10 * POWER(2, LEAST(attempts, 8)))
           ),
           updated_at      = now()
     WHERE id IN (
           SELECT id
             FROM request_outbox
            WHERE status = 'PENDING'
              AND next_attempt_at <= now()
            ORDER BY created_at
            LIMIT :batch_size
            FOR UPDATE SKIP LOCKED
     )
    RETURNING *
    """
)


def claim_pending(conn: Connection, batch_size: int) -> list[dict]:
    """Take a batch of due rows and back them off in the same statement.

    `FOR UPDATE SKIP LOCKED` is what makes the relay safe to run concurrently:
    two overlapping sweeps claim disjoint rows instead of double-publishing or
    blocking on each other. Do not replace it with a status flag plus a
    separate SELECT and UPDATE — that has a race in it.

    The backoff is applied on claim rather than on failure, so a row whose
    publish attempt crashes the process still comes back later instead of
    being retried in a tight loop.
    """
    rows = conn.execute(_CLAIM_SQL, {"batch_size": batch_size}).mappings().all()
    return [dict(r) for r in rows]


def mark_published(conn: Connection, outbox_id: int) -> None:
    conn.execute(
        text(
            """
            UPDATE request_outbox
               SET status       = 'PUBLISHED',
                   published_at = now(),
                   last_error   = NULL,
                   updated_at   = now()
             WHERE id = :id
            """
        ),
        {"id": outbox_id},
    )


def mark_failed(conn: Connection, outbox_id: int, error: str) -> None:
    """Leave it PENDING. `claim_pending` already pushed `next_attempt_at` out."""
    conn.execute(
        text(
            """
            UPDATE request_outbox
               SET last_error = :error,
                   updated_at = now()
             WHERE id = :id
            """
        ),
        {"id": outbox_id, "error": error[:2000]},
    )


def mark_dead(conn: Connection, outbox_id: int, error: str) -> None:
    """Give up on this message and fail the file it belonged to.

    This is the ONLY path by which a publish failure becomes a failed file,
    and it happens after roughly three hours of retries rather than on the
    first error. Failing terminally on a transient Pub/Sub blip would throw
    away work the user asked for with no route back.
    """
    conn.execute(
        text(
            """
            UPDATE request_outbox
               SET status     = 'DEAD',
                   last_error = :error,
                   updated_at = now()
             WHERE id = :id
            """
        ),
        {"id": outbox_id, "error": error[:2000]},
    )


def relay(conn: Connection, cfg: Config, publisher: Publisher) -> dict[str, int]:
    """Publish everything that is due. Returns counts for the sweep report."""
    claimed = claim_pending(conn, cfg.outbox_batch_size)
    published = failed = dead = 0

    for row in claimed:
        attributes = {
            "requestId": str(row["request_id"]),
            "outboxId": str(row["id"]),
        }
        if row.get("file_id"):
            attributes["fileId"] = str(row["file_id"])

        try:
            publisher.publish(row["topic"], row["payload"], attributes)
        except Exception as exc:  # noqa: BLE001 - every failure is recorded
            message = f"{type(exc).__name__}: {exc}"
            if row["attempts"] >= cfg.outbox_max_attempts:
                mark_dead(conn, row["id"], message)
                _fail_file_for_dead_outbox(conn, row)
                dead += 1
                log.error(
                    "outbox row dead after %s attempts",
                    row["attempts"],
                    extra={"outboxId": row["id"], "fileId": row.get("file_id")},
                )
            else:
                mark_failed(conn, row["id"], message)
                failed += 1
                log.warning(
                    "outbox publish failed, will retry",
                    extra={"outboxId": row["id"], "attempts": row["attempts"]},
                )
            continue

        mark_published(conn, row["id"])
        published += 1

    return {
        "claimed": len(claimed),
        "published": published,
        "retrying": failed,
        "dead": dead,
    }


def _fail_file_for_dead_outbox(conn: Connection, row: dict) -> None:
    if not row.get("file_id"):
        return
    conn.execute(
        text(
            """
            UPDATE files
               SET stage          = 'FAILED',
                   claimed_by     = NULL,
                   claimed_until  = NULL,
                   failure_class  = 'internal',
                   failure_detail = 'Could not be queued for processing.',
                   updated_at     = now()
             WHERE id = :file_id
               AND stage <> 'FAILED'
            """
        ),
        {"file_id": row["file_id"]},
    )
