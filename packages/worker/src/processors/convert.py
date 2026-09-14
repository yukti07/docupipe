"""The convert processor — reads a file and writes its output.

**This phase writes one line of text.** The real extraction engine is the next
phase and replaces this file and nothing else.

What is real today is the shape around it: the file was claimed under a lease,
the user approved its schema at the gate, the output path is deterministic, and
the per-table result rows the processing screen reads are written here.
"""

from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.engine import Connection

from ..failures import FailureClass, QuarryFailure
from ..models import EventType
from ..storage import ObjectNotFound, Storage, output_key
from .. import events

log = logging.getLogger(__name__)


def run(conn: Connection, cfg, file_row: dict, storage: Storage) -> str:
    file_id = file_row["id"]
    request_id = file_row["request_id"]
    user_id = file_row["user_id"]
    object_key = file_row.get("object_key")
    filename = file_row["original_filename"]

    events.record(
        conn,
        request_id=request_id,
        user_id=user_id,
        file_id=file_id,
        event_type=EventType.CONVERT_STARTED,
    )

    _set_table_stage(conn, file_id, "EXTRACTING")

    if not object_key:
        raise QuarryFailure(
            FailureClass.ACQUISITION,
            "No object was ever written for this file.",
        )

    try:
        storage.read(object_key)
    except ObjectNotFound as exc:
        raise QuarryFailure(
            FailureClass.ACQUISITION,
            "The uploaded file isn't in storage.",
        ) from exc

    # The acceptance criterion (§30, §42). `original_filename` deliberately —
    # the name the user gave the file, not the object key and not the
    # sanitised segment inside it. Neither of those is what a person would
    # recognise.
    body = f"Successfully processed {filename}\n".encode("utf-8")
    key = output_key(request_id, file_id)

    try:
        storage.write(key, body, content_type="text/plain; charset=utf-8")
    except Exception as exc:  # noqa: BLE001
        raise QuarryFailure(
            FailureClass.PROCESSING_FAILED,
            "Couldn't write the result for this file.",
        ) from exc

    events.record(
        conn,
        request_id=request_id,
        user_id=user_id,
        file_id=file_id,
        event_type=EventType.OUTPUT_WRITTEN,
        message=f"Wrote {key}",
        metadata={"objectKey": key, "bytes": len(body)},
    )

    _set_table_stage(conn, file_id, "DONE", row_count=0)

    return "COMPLETED"


def _set_table_stage(
    conn: Connection, file_id: str, stage: str, row_count: int | None = None
) -> None:
    """Move every table in this file to a stage.

    Per-table rather than per-file because §0.7's counts are per table: a
    three-sheet spreadsheet is one file row and three result rows, and the
    five counts must sum to the number of tables in the request.

    A real processor will set these per table as each one finishes. This one
    moves them together, because it does one thing per file.
    """
    params: dict = {"file_id": file_id, "stage": stage}
    sets = ["stage = CAST(:stage AS table_stage)", "updated_at = now()"]

    if stage == "EXTRACTING":
        sets.append("started_at = COALESCE(started_at, now())")
    if stage == "DONE":
        sets.append("completed_at = now()")
    if row_count is not None:
        sets.append("row_count = :row_count")
        params["row_count"] = row_count

    conn.execute(
        text(f"UPDATE file_schema_results SET {', '.join(sets)} WHERE file_id = :file_id"),
        params,
    )


def mark_tables_failed(
    conn: Connection, file_id: str, failure_class: str, detail: str | None
) -> None:
    """Carry a file's failure down onto its tables.

    Without this a failed file leaves its tables at QUEUED forever, the counts
    never reach the table total, and the processing screen shows a stage that
    has lost a table.
    """
    conn.execute(
        text(
            """
            UPDATE file_schema_results
               SET stage          = 'FAILED',
                   failure_class  = CAST(:failure_class AS failure_class),
                   failure_detail = :detail,
                   completed_at   = now(),
                   updated_at     = now()
             WHERE file_id = :file_id
               AND stage <> 'DONE'
            """
        ),
        {
            "file_id": file_id,
            "failure_class": failure_class,
            "detail": (detail or "")[:2000] or None,
        },
    )
