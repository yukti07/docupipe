"""One delivery, start to finish.

This is the only place stage changes happen, and it is identical in both
services — only the processor differs (§28).
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, replace

from sqlalchemy import text

from . import db, events, leases
from .config import Config, ServiceRole, get_config
from .failures import FailureClass, classify, is_retryable, pauses_request
from .leases import ClaimOutcome
from .models import EventType
from .processors import convert as convert_processor
from .processors import inspect as inspect_processor
from .publisher import get_publisher
from .storage import get_storage

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Result:
    outcome: ClaimOutcome
    file_id: str
    detail: str = ""

    @property
    def http_status(self) -> int:
        return self.outcome.http_status


#: Which role can advance a file sitting at each stage.
_ROLE_FOR_STAGE = {
    "UPLOADED": ServiceRole.INSPECT,
    "INSPECTING": ServiceRole.INSPECT,
    "CONVERTING": ServiceRole.CONVERT,
}


def _resolve_role(cfg: Config, file_id: str) -> Config | None:
    """Pick the role this delivery needs.

    Deployed, each topic pushes to its own service and the configured role is
    the answer. Running as BOTH, one process serves both topics, so the FILE
    ROW decides — which is what the contract always said: the topic tells the
    worker which service it is, not what to do.

    Returns None when no role can advance this file, which is an ack: the work
    is already done, or the row is in a stage nobody claims.
    """
    if cfg.role is not ServiceRole.BOTH:
        return cfg

    with db.connection() as conn:
        stage = conn.execute(
            text("SELECT stage::text FROM files WHERE id = :id"), {"id": file_id}
        ).scalar()

    role = _ROLE_FOR_STAGE.get(stage or "")
    return replace(cfg, role=role) if role else None


def handle(file_id: str, cfg: Config | None = None) -> Result:
    cfg = cfg or get_config()

    resolved = _resolve_role(cfg, file_id)
    if resolved is None:
        log.info("nothing to do", extra={"fileId": file_id})
        return Result(ClaimOutcome.ALREADY_DONE, file_id, "no role for this stage")
    cfg = resolved

    with db.transaction() as conn:
        claim = leases.claim(conn, cfg, file_id)

        if not claim.claimed:
            if claim.outcome is ClaimOutcome.EXHAUSTED and claim.file:
                _fail_exhausted(conn, cfg, claim.file)
            log.info(
                "not claimed: %s",
                claim.outcome.value,
                extra={"fileId": file_id, "detail": claim.detail},
            )
            return Result(claim.outcome, file_id, claim.detail)

        file_row = claim.file or {}

    # The lease is committed, so this worker owns the file. Processing happens
    # OUTSIDE that transaction: holding one open across minutes of work would
    # pin a connection and block the reaper's view of the row.
    heartbeat = _Heartbeat(cfg, file_id)
    heartbeat.start()
    try:
        return _process(cfg, file_row)
    finally:
        heartbeat.stop()


def _process(cfg: Config, file_row: dict) -> Result:
    file_id = file_row["id"]
    storage = get_storage(cfg)
    processor = inspect_processor if cfg.role is ServiceRole.INSPECT else convert_processor

    chained = False
    try:
        with db.transaction() as conn:
            next_stage = processor.run(conn, cfg, file_row, storage)
            leases.complete(conn, cfg, file_id, next_stage)
            events.record(
                conn,
                request_id=file_row["request_id"],
                user_id=file_row["user_id"],
                file_id=file_id,
                event_type=EventType.FILE_COMPLETED,
                metadata={"stage": next_stage, "role": cfg.role.value},
            )
            if cfg.role is ServiceRole.INSPECT and next_stage == "SCHEMA_READY":
                chained = _convert_if_already_requested(conn, cfg, file_row)
            _refresh_request_status(conn, file_row["request_id"])
        log.info("processed", extra={"fileId": file_id, "role": cfg.role.value})
        if chained:
            _relay_now(cfg)
        return Result(ClaimOutcome.CLAIMED, file_id)

    except Exception as exc:  # noqa: BLE001 - every failure gets a class
        failure_class, detail = classify(exc)
        log.warning(
            "processing failed: %s",
            failure_class.value,
            extra={"fileId": file_id, "detail": detail},
            exc_info=failure_class is FailureClass.INTERNAL,
        )
        _record_failure(cfg, file_row, failure_class, detail)
        # The message is acked either way. A retryable failure is retried by
        # the reaper from the database, not by making Pub/Sub redeliver — one
        # retry mechanism, not two disagreeing ones.
        return Result(ClaimOutcome.CLAIMED, file_id, detail)


#: Convert was pressed before this file's shape was in. The request already
#: says so, so the file goes straight on rather than waiting for a second press
#: that is never coming.
_CHAIN_CONVERT_SQL = text(
    """
    UPDATE files f
       SET stage = 'CONVERTING', updated_at = now()
      FROM requests r
     WHERE f.id = :file_id
       AND r.id = f.request_id
       AND r.converted_at IS NOT NULL
       AND f.stage = 'SCHEMA_READY'
    RETURNING f.id
    """
)


def _convert_if_already_requested(conn, cfg: Config, file_row: dict) -> bool:
    """Carry a just-inspected file into conversion if Convert already happened.

    Nobody has to press it twice, and nothing has to poll for the shape: the
    row that says the request was converted is the one this reads, in the same
    transaction that settled the shape.

    Returns whether it queued anything, so the caller can publish immediately
    instead of leaving it for the next sweep.
    """
    from . import outbox

    moved = conn.execute(_CHAIN_CONVERT_SQL, {"file_id": file_row["id"]}).first()
    if moved is None:
        return False

    outbox.enqueue(
        conn,
        request_id=file_row["request_id"],
        file_id=file_row["id"],
        topic=cfg.topic_convert_requested,
        payload={"fileId": file_row["id"]},
    )
    events.record(
        conn,
        request_id=file_row["request_id"],
        user_id=file_row["user_id"],
        file_id=file_row["id"],
        event_type=EventType.CONVERT_REQUESTED,
        message="Convert was pressed before this shape landed.",
        metadata={"chained": True},
    )
    log.info("chained straight to convert", extra={"fileId": file_row["id"]})
    return True


def _relay_now(cfg: Config) -> None:
    """Publish what was just queued, rather than waiting on the sweep.

    The row is committed either way — this is the fast path, exactly as it is
    on the web side, and a failure here is a delay of one sweep, not a loss.
    """
    from . import outbox

    try:
        with db.transaction() as conn:
            outbox.relay(conn, cfg, get_publisher(cfg))
    except Exception:  # noqa: BLE001 - the sweep is the backstop
        log.warning("immediate relay failed; the sweep will pick it up")


def _record_failure(cfg: Config, file_row: dict, failure_class, detail: str) -> None:
    file_id = file_row["id"]
    attempts = int(file_row.get("attempts") or 0)
    max_attempts = int(file_row.get("max_attempts") or cfg.max_attempts)

    with db.transaction() as conn:
        # Some classes are not failures at all: they park the request with a
        # resume time and the sweep picks it back up, leaving the file in the
        # queue untouched. `failures.py` decides which, so adding one later is
        # a change in one place.
        if pauses_request(failure_class):
            _pause_request(conn, cfg, file_row, detail)
            return

        retry_possible = is_retryable(failure_class) and attempts < max_attempts
        if retry_possible:
            back_to = "UPLOADED" if cfg.role is ServiceRole.INSPECT else "CONVERTING"
            leases.release(conn, cfg, file_id, back_to)
            _enqueue_retry(conn, cfg, file_row, back_to)
            events.record(
                conn,
                request_id=file_row["request_id"],
                user_id=file_row["user_id"],
                file_id=file_id,
                event_type=EventType.FILE_RECLAIMED,
                message=detail,
                metadata={"failureClass": failure_class.value, "attempt": attempts},
            )
            return

        leases.fail(conn, cfg, file_id, failure_class, detail)
        convert_processor.mark_tables_failed(conn, file_id, failure_class.value, detail)
        events.record(
            conn,
            request_id=file_row["request_id"],
            user_id=file_row["user_id"],
            file_id=file_id,
            event_type=EventType.FILE_FAILED,
            message=detail,
            metadata={"failureClass": failure_class.value},
        )
        _refresh_request_status(conn, file_row["request_id"])


def _fail_exhausted(conn, cfg: Config, file_row: dict) -> None:
    leases.fail(
        conn,
        cfg,
        file_row["id"],
        FailureClass.MAX_ATTEMPTS,
        "Stopped after repeated failures.",
    )
    convert_processor.mark_tables_failed(
        conn, file_row["id"], FailureClass.MAX_ATTEMPTS.value, None
    )
    events.record(
        conn,
        request_id=file_row["request_id"],
        user_id=file_row["user_id"],
        file_id=file_row["id"],
        event_type=EventType.FILE_FAILED,
        metadata={"failureClass": FailureClass.MAX_ATTEMPTS.value},
    )
    _refresh_request_status(conn, file_row["request_id"])


def _enqueue_retry(conn, cfg: Config, file_row: dict, stage: str) -> None:
    from . import outbox

    outbox.enqueue(
        conn,
        request_id=file_row["request_id"],
        file_id=file_row["id"],
        topic=cfg.topic_for_stage(stage),
        payload={"fileId": file_row["id"]},
    )


def _pause_request(conn, cfg: Config, file_row: dict, detail: str) -> None:
    """Park the request with a resume time and put the file back.

    This is the single most important line in the failure model: on a limited
    allowance this is the NORMAL state, not an exception. A system that renders
    its normal state as an error teaches people to ignore errors.
    """
    back_to = "UPLOADED" if cfg.role is ServiceRole.INSPECT else "CONVERTING"
    leases.release(conn, cfg, file_row["id"], back_to)
    conn.execute(
        text(
            """
            UPDATE requests
               SET status       = 'PAUSED',
                   paused_until = COALESCE(paused_until, now() + interval '1 hour'),
                   updated_at   = now()
             WHERE id = :request_id
               AND status NOT IN ('COMPLETED', 'FAILED')
            """
        ),
        {"request_id": file_row["request_id"]},
    )
    events.record(
        conn,
        request_id=file_row["request_id"],
        user_id=file_row["user_id"],
        file_id=file_row["id"],
        event_type=EventType.REQUEST_PAUSED,
        message=detail,
    )


_REFRESH_SQL = text(
    """
    WITH counts AS (
        SELECT
            COUNT(*)                                                    AS total,
            COUNT(*) FILTER (WHERE stage IN ('SCHEMA_READY','FAILED'))  AS settled,
            COUNT(*) FILTER (WHERE stage IN ('COMPLETED','FAILED'))     AS terminal,
            COUNT(*) FILTER (WHERE stage = 'FAILED')                    AS failed
          FROM files
         WHERE request_id = :request_id
           AND deleted_at IS NULL
    )
    UPDATE requests r
       SET status = CAST(CASE
             WHEN r.converted_at IS NOT NULL AND c.terminal = c.total AND c.failed = c.total
                  THEN 'FAILED'
             WHEN r.converted_at IS NOT NULL AND c.terminal = c.total
                  THEN 'COMPLETED'
             WHEN r.converted_at IS NOT NULL
                  THEN 'CONVERTING'
             WHEN c.settled = c.total AND c.total > 0
                  THEN 'READY'
             ELSE 'COLLECTING'
           END AS request_status),
           file_count = c.total,
           paused_until = NULL,
           updated_at = now()
      FROM counts c
     WHERE r.id = :request_id
       AND r.status <> 'PAUSED'
    """
)


def _refresh_request_status(conn, request_id: str) -> None:
    """Recompute the request's status from its files.

    READY is the Convert gate, and "settled" means SCHEMA_READY **or** FAILED —
    one unreadable file must not hold fifty good ones hostage. Computing it
    here rather than having the UI poll for it means the gate has exactly one
    definition.
    """
    conn.execute(_REFRESH_SQL, {"request_id": request_id})


class _Heartbeat:
    """Renews the lease while work is running.

    Both processors are fast enough today that a 600 s lease would never
    expire under them. The real extraction engine will exceed it, and renewal
    is much easier to add now than to retrofit into a processor that already
    assumes it is safe.
    """

    def __init__(self, cfg: Config, file_id: str):
        self.cfg = cfg
        self.file_id = file_id
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        interval = max(5, self.cfg.lease_seconds // 3)
        self._thread = threading.Thread(
            target=self._loop, args=(interval,), daemon=True, name=f"lease:{self.file_id}"
        )
        self._thread.start()

    def _loop(self, interval: int) -> None:
        while not self._stop.wait(interval):
            try:
                with db.transaction() as conn:
                    until = leases.renew(conn, self.cfg, self.file_id)
                if until is None:
                    # Lost the lease — the reaper took it. Stop renewing and
                    # let the other worker own it.
                    log.warning("lease lost", extra={"fileId": self.file_id})
                    return
            except Exception:  # noqa: BLE001
                log.exception("lease renewal failed", extra={"fileId": self.file_id})

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
