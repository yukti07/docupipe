"""Database engine and session handling.

SQLAlchemy Core, never the ORM and never migrations. Prisma owns the schema
(§4, §13); this side reads and writes the tables it already found there.

Three connection shapes, all the same mechanism (§36):

  * Cloud Run      -> the platform's built-in proxy at /cloudsql/<instance>
  * local / tests  -> a plain DATABASE_URL (docker compose, or cloud-sql-proxy)
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.engine.url import URL

from .config import Config, get_config

log = logging.getLogger(__name__)

_engine: Engine | None = None


def build_url(cfg: Config) -> str | URL:
    """A plain DATABASE_URL wins when set; otherwise the Cloud SQL socket."""
    if cfg.database_url:
        # Accept the postgres:// spelling people paste out of consoles.
        url = cfg.database_url
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql://", 1)
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        return url

    if not cfg.instance_connection_name:
        raise RuntimeError(
            "No database configured. Set DATABASE_URL, or "
            "INSTANCE_CONNECTION_NAME with DB_USER / DB_PASSWORD / DB_NAME."
        )

    # The socket path goes in the query string, not the host field — it is a
    # directory, not a hostname. This is the single most common way to get the
    # Cloud SQL socket connection wrong.
    return URL.create(
        drivername="postgresql+psycopg",
        username=cfg.db_user,
        password=cfg.db_password,
        database=cfg.db_name,
        query={"host": f"/cloudsql/{cfg.instance_connection_name}"},
    )


def get_engine(cfg: Config | None = None) -> Engine:
    global _engine
    if _engine is not None:
        return _engine

    cfg = cfg or get_config()
    _engine = create_engine(
        build_url(cfg),
        pool_size=cfg.db_pool_size,
        max_overflow=0,
        # Cloud Run freezes idle instances, so a resumed connection may be dead
        # in a way that only shows up on the next statement.
        pool_pre_ping=True,
        pool_recycle=1800,
        future=True,
    )
    return _engine


def dispose_engine() -> None:
    """Tests build a fresh engine per database."""
    global _engine
    if _engine is not None:
        _engine.dispose()
        _engine = None


def set_engine(engine: Engine | None) -> None:
    """Inject an engine. Used by tests; not used in production code."""
    global _engine
    _engine = engine


@contextmanager
def transaction() -> Iterator:
    """One unit of work.

    Everything that must agree happens inside one of these — in particular a
    stage change and the outbox row that announces it (§24.2).
    """
    engine = get_engine()
    with engine.begin() as conn:
        yield conn


@contextmanager
def connection() -> Iterator:
    """A read-only connection for queries that change nothing."""
    engine = get_engine()
    with engine.connect() as conn:
        yield conn


def check_health() -> bool:
    """`SELECT 1` with a short timeout, for /readyz."""
    try:
        with connection() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        log.exception("database health check failed")
        return False
