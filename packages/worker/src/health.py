"""Three endpoints, because there are three different questions (§40).

A single {"status":"ok"} answers "is the process running", which is the one
question that is never in doubt when something is actually wrong.

  /health   is the process up            no dependency calls at all
  /readyz   can it reach its dependencies
  /healthz  is work actually moving      the one that distinguishes alive
                                         from stuck
"""

from __future__ import annotations

import logging

from sqlalchemy import text

from . import db
from .config import Config, get_config
from .storage import get_storage

log = logging.getLogger(__name__)


def liveness() -> dict:
    """No database, no storage, no network. Must answer in milliseconds.

    This is the only endpoint a Cloud Run probe points at. A liveness probe
    that touches PostgreSQL turns a database blip into a restart loop, which
    turns a five-minute incident into a thirty-minute one.
    """
    return {"status": "ok"}


def readiness(cfg: Config | None = None) -> tuple[dict, int]:
    cfg = cfg or get_config()
    checks: dict[str, str] = {}

    checks["database"] = "ok" if db.check_health() else "failing"

    try:
        get_storage(cfg).stat("__healthz__/probe")
        checks["storage"] = "ok"
    except Exception as exc:  # noqa: BLE001
        log.warning("storage readiness check failed: %s", exc)
        checks["storage"] = "failing"

    ok = all(v == "ok" for v in checks.values())
    return {"status": "ok" if ok else "unhealthy", "checks": checks}, (200 if ok else 503)


_QUEUE_SQL = text(
    """
    SELECT
      COUNT(*) FILTER (WHERE stage IN ('UPLOADED','CONVERTING')
                         AND claimed_until IS NULL)                     AS queued,
      COUNT(*) FILTER (WHERE stage IN ('INSPECTING','CONVERTING')
                         AND claimed_until >= now())                    AS processing,
      COUNT(*) FILTER (WHERE stage IN ('INSPECTING','CONVERTING')
                         AND claimed_until <  now())                    AS stuck,
      COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at)
               FILTER (WHERE stage IN ('UPLOADED','CONVERTING')
                         AND claimed_until IS NULL)))::int, 0)          AS oldest_queued_age_s
      FROM files
     WHERE deleted_at IS NULL
    """
)

_OUTBOX_SQL = text(
    """
    SELECT
      COUNT(*) FILTER (WHERE status = 'PENDING')                        AS pending,
      COUNT(*) FILTER (WHERE status = 'DEAD')                           AS dead,
      COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at)
               FILTER (WHERE status = 'PENDING')))::int, 0)             AS oldest_pending_age_s
      FROM request_outbox
    """
)


def deep(cfg: Config | None = None) -> tuple[dict, int]:
    """Queue and outbox aggregates — the "is anything moving" endpoint.

    Everything here is a cheap aggregate over tables that already exist. It is
    polled, so it must not become the load: one statement each, both hitting
    an index.
    """
    cfg = cfg or get_config()

    try:
        with db.connection() as conn:
            queue = dict(conn.execute(_QUEUE_SQL).mappings().one())
            ob = dict(conn.execute(_OUTBOX_SQL).mappings().one())
    except Exception:  # noqa: BLE001
        log.exception("healthz query failed")
        return {"status": "unhealthy", "database": "failing"}, 503

    reasons: list[str] = []

    # An outbox backlog means the sweep has stopped. Files are being accepted
    # and never queued, and nothing else in the system will notice.
    if ob["oldest_pending_age_s"] > 300:
        reasons.append("outbox backlog older than 5 minutes")
    if queue["stuck"] > 0:
        reasons.append("files with expired leases")
    if queue["oldest_queued_age_s"] > 900:
        reasons.append("queued files older than 15 minutes")
    if ob["dead"] > 0:
        reasons.append("dead outbox rows")

    status = "degraded" if reasons else "ok"

    body = {
        "status": status,
        "role": cfg.role.value,
        "version": cfg.version,
        "database": "ok",
        "queue": queue,
        "outbox": {
            "pending": ob["pending"],
            "dead": ob["dead"],
            "oldest_pending_age_s": ob["oldest_pending_age_s"],
        },
    }
    if reasons:
        body["reasons"] = reasons

    # `degraded` returns 200 deliberately. A 503 here would make the load
    # balancer pull a perfectly serviceable instance out of rotation at
    # exactly the moment the backlog needs draining.
    return body, 200
