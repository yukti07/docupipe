"""Structured JSON logs, with the trace ids bound once.

`requestTraceId` and `userId` are bound at the entry point — the push handler,
the sweep handler — so every later line carries them without anyone having to
remember. A field passed by hand into each log call is the field missing from
the one line you need.

Two filters are then single queries rather than investigations:

    requestTraceId = "req_8f1c"   everything one click caused, across services
    userId         = "usr_1a2b"   everything this person has ever done
"""

from __future__ import annotations

import contextvars
import json
import logging
import sys
from typing import Any

_context: contextvars.ContextVar[dict[str, Any]] = contextvars.ContextVar(
    "log_context", default={}
)

_RESERVED = frozenset(
    logging.LogRecord("", 0, "", 0, "", (), None).__dict__.keys()
) | {"message", "asctime", "taskName"}

#: Never log these, anywhere (§44).
_REDACT = frozenset(
    {"password", "db_password", "signed_url", "signedUrl", "token", "secret", "authorization"}
)


def bind(**values: Any) -> None:
    """Add fields to every subsequent log line in this context."""
    current = dict(_context.get())
    current.update({k: v for k, v in values.items() if v is not None})
    _context.set(current)


def clear() -> None:
    _context.set({})


class _ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        for key, value in _context.get().items():
            if not hasattr(record, key):
                setattr(record, key, value)
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            # Cloud Logging picks these two up by name.
            "severity": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
        }

        for key, value in record.__dict__.items():
            if key in _RESERVED or key.startswith("_"):
                continue
            if key.lower() in _REDACT:
                continue
            payload[key] = value

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, default=str)


def configure(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(_ContextFilter())

    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)

    # These two are noisy and say nothing we do not already log ourselves.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
