"""The inspect processor — reads a file and writes its shape.

**This phase writes a fixed placeholder shape.** Real schema inference is the
next phase and replaces this file and nothing else.

Even so, it writes a *real* `file_schemas` row with real `original_fields` and
a real `shape_hash`, because that is what makes the whole pre-Convert flow
exercisable end to end today: fetching a schema, grouping by shape, the
apply-to-all count, and the merge compatibility check all work before any
inference exists.

One rule here is load-bearing and survives the replacement:

    ALL of a file's schemas are written in ONE transaction.

§0.4's poll is a delta keyed on `fileId`. If a file were half-written, the
client would mark it received and its later tables would be permanently
filtered out. All-or-nothing per file is what makes that delta safe.
"""

from __future__ import annotations

import logging
import secrets

from sqlalchemy import text
from sqlalchemy.engine import Connection

from ..failures import FailureClass, QuarryFailure
from ..models import EventType
from ..shapes import make_field, shape_hash
from ..storage import ObjectNotFound, Storage
from .. import events

log = logging.getLogger(__name__)

#: The placeholder every file gets until inference lands.
PLACEHOLDER_FIELDS = [
    make_field("column_a", label="Column A", type_="text"),
    make_field("column_b", label="Column B", type_="number"),
    make_field("column_c", label="Column C", type_="date"),
]

PLACEHOLDER_LABEL = "Table 1"


def new_schema_id() -> str:
    return f"sch_{secrets.token_hex(8)}"


def run(conn: Connection, cfg, file_row: dict, storage: Storage) -> str:
    """Inspect one file. Returns the stage it should end at.

    Raises QuarryFailure for anything classified; everything else becomes
    `internal` in the caller.
    """
    file_id = file_row["id"]
    request_id = file_row["request_id"]
    user_id = file_row["user_id"]
    object_key = file_row.get("object_key")

    events.record(
        conn,
        request_id=request_id,
        user_id=user_id,
        file_id=file_id,
        event_type=EventType.INSPECT_STARTED,
    )

    if not object_key:
        raise QuarryFailure(
            FailureClass.ACQUISITION,
            "No object was ever written for this file.",
        )

    try:
        data = storage.read(object_key)
    except ObjectNotFound as exc:
        raise QuarryFailure(
            FailureClass.ACQUISITION,
            "The uploaded file isn't in storage.",
        ) from exc

    if not data:
        raise QuarryFailure(FailureClass.EMPTY_FILE, "This file is empty.")

    detected = _sniff(data)
    declared = (file_row.get("content_type") or "").split(";")[0].strip().lower()
    filename = (file_row.get("original_filename") or "").lower()

    # The client pre-flights archives, but the client is not the authority on
    # anything. This is the first point that looks at the actual bytes, and a
    # real archive is caught here whether or not it was named like one.
    if _is_bare_archive(detected, declared, filename):
        raise QuarryFailure(
            FailureClass.ARCHIVE_NOT_EXPANDED,
            "Archives aren't read yet.",
        )

    # The declared type is a client claim; this is where it is checked against
    # the bytes. A real mismatch is format_corrupt.
    if declared and detected and _families_disagree(declared, detected):
        raise QuarryFailure(
            FailureClass.FORMAT_CORRUPT,
            f"This file says {declared} but is actually {detected}.",
        )

    if detected == "application/pdf" and data[:1024].find(b"/Encrypt") != -1:
        raise QuarryFailure(
            FailureClass.FORMAT_LOCKED,
            "Password-protected, so its pages can't be opened.",
        )

    conn.execute(
        text("UPDATE files SET detected_content_type = :d WHERE id = :id"),
        {"d": detected, "id": file_id},
    )

    _write_schemas(conn, file_id=file_id, request_id=request_id)

    events.record(
        conn,
        request_id=request_id,
        user_id=user_id,
        file_id=file_id,
        event_type=EventType.SCHEMA_WRITTEN,
        message="Placeholder shape written (inference not implemented yet).",
        metadata={"tableCount": 1, "placeholder": True},
    )

    return "SCHEMA_READY"


def _write_schemas(conn: Connection, *, file_id: str, request_id: str) -> None:
    """Write every table's schema for this file, atomically.

    `ON CONFLICT (file_id, table_ord) DO NOTHING` makes a redelivery a no-op
    rather than a duplicate — the unique index is what turns at-least-once
    delivery into exactly-once effect here.
    """
    fields = PLACEHOLDER_FIELDS
    digest = shape_hash(fields)

    conn.execute(
        text(
            """
            INSERT INTO file_schemas
                (id, file_id, request_id, table_ord, table_label, version,
                 fields, original_fields, shape_hash, created_at)
            VALUES
                (:id, :file_id, :request_id, :table_ord, :table_label, 1,
                 CAST(:fields AS jsonb), CAST(:fields AS jsonb), :shape_hash, now())
            ON CONFLICT (file_id, table_ord) DO NOTHING
            """
        ),
        {
            "id": new_schema_id(),
            "file_id": file_id,
            "request_id": request_id,
            "table_ord": 0,
            "table_label": PLACEHOLDER_LABEL,
            "fields": _json(fields),
            "shape_hash": digest,
        },
    )

    # Seed the per-table result row so /api/polling/result has something to
    # count before the convert worker has run. Counts must sum to the number
    # of tables in the request, including the ones not started yet.
    conn.execute(
        text(
            """
            INSERT INTO file_schema_results
                (file_schema_id, file_id, request_id, stage,
                 row_count, field_count, to_check_count, updated_at)
            SELECT fs.id, fs.file_id, fs.request_id, 'QUEUED',
                   0, jsonb_array_length(fs.fields), 0, now()
              FROM file_schemas fs
             WHERE fs.file_id = :file_id
            ON CONFLICT (file_schema_id) DO NOTHING
            """
        ),
        {"file_id": file_id},
    )


def _json(value) -> str:
    import json

    return json.dumps(value)


_MAGIC = (
    (b"%PDF-", "application/pdf"),
    (b"PK\x03\x04", "application/zip"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"\xd0\xcf\x11\xe0", "application/vnd.ms-office"),
)


def _sniff(data: bytes) -> str:
    """Content type from magic bytes.

    The extension lies more often than you would think, and so does the
    declared Content-Type — both come from the client. This is the first point
    in the system that looks at the actual bytes.
    """
    head = data[:16]
    for signature, content_type in _MAGIC:
        if head.startswith(signature):
            return content_type
    try:
        data[:4096].decode("utf-8")
    except UnicodeDecodeError:
        return "application/octet-stream"
    return "text/plain"


#: Types that legitimately share magic bytes, so a mismatch is not a lie.
#: .docx/.xlsx/.pptx are all ZIP containers; CSV and JSON are all text.
_FAMILIES = {
    "application/zip": {
        "application/zip",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    },
    "text/plain": {
        "text/plain",
        "text/csv",
        "application/json",
        "text/markdown",
        "application/xml",
        "text/xml",
        "",
    },
}


def _families_disagree(declared: str, detected: str) -> bool:
    family = _FAMILIES.get(detected)
    if family is not None:
        return declared not in family
    return declared != detected


#: Office formats are ZIP containers too, so "the bytes say zip" is not enough
#: on its own — .docx and .xlsx would fail on every upload.
_OFFICE_ZIP = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.oasis.opendocument.text",
)

_ARCHIVE_SUFFIXES = (".zip", ".rar", ".7z", ".tar", ".gz", ".tgz")


def _is_bare_archive(detected: str, declared: str, filename: str) -> bool:
    """A real archive, rather than an Office file that happens to be one."""
    if declared in _OFFICE_ZIP:
        return False
    if filename.endswith(_ARCHIVE_SUFFIXES):
        return True
    return detected == "application/zip" and declared in ("", "application/zip")
