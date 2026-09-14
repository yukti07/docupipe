"""Writing to the audit trail.

`file_events` is no longer read by the browser — §0 replaced SSE with polling
— but it is still how a support question gets answered and still what the
health endpoint counts against. Events are written in the SAME transaction as
the change they describe, so the trail cannot claim something that did not
happen.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection


def record(
    conn: Connection,
    *,
    request_id: str,
    user_id: str,
    event_type: str,
    file_id: str | None = None,
    message: str | None = None,
    metadata: dict[str, Any] | None = None,
    request_trace_id: str | None = None,
) -> None:
    conn.execute(
        text(
            """
            INSERT INTO file_events
                (request_id, file_id, user_id, request_trace_id,
                 event_type, message, metadata, created_at)
            VALUES
                (:request_id, :file_id, :user_id, :request_trace_id,
                 :event_type, :message, CAST(:metadata AS jsonb), now())
            """
        ),
        {
            "request_id": request_id,
            "file_id": file_id,
            "user_id": user_id,
            "request_trace_id": request_trace_id,
            "event_type": event_type,
            "message": message,
            "metadata": json.dumps(metadata) if metadata is not None else None,
        },
    )
