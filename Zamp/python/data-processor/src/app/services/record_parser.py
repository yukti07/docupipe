"""Turning an untrusted model response into records for the approved schema.

The mirror of the detector's `schema_parser`: same digging, different contract.
Here the answer is a list of row objects rather than one schema object, and the
schema is already fixed — this stage only has to establish that what came back
is a list of records, not that it describes anything.
"""

from __future__ import annotations

import logging
from typing import Any

from zamp_shared.domain import Schema
from zamp_shared.errors import InvalidInput
from zamp_shared.json_extract import parse_direct, scan, strip_fences

log = logging.getLogger(__name__)

#: Keys a model reaches for when it wraps an array in an object. The prompt asks
#: for "records"; the others are what it says instead often enough to matter.
RECORD_KEYS = ("records", "rows", "data", "items", "results")


def parse_records(raw: str, schema: Schema) -> list[dict[str, Any]]:
    if not isinstance(raw, str) or not raw.strip():
        raise InvalidInput("Gemini returned no text", "GEMINI_EMPTY_RESPONSE")

    cleaned = strip_fences(raw.strip())
    records = _find(cleaned)
    if records is None:
        log.warning("no records in gemini response", extra={"stage": "extract", "response_length": len(raw)})
        raise InvalidInput("Gemini response did not contain a list of records", "GEMINI_JSON_INVALID")

    for index, record in enumerate(records, start=1):
        if not isinstance(record, dict):
            raise InvalidInput(f"Record {index} from Gemini is not an object", "GEMINI_RECORDS_INVALID")

    if not records:
        # A schema was detected from this image, so something table-shaped was
        # there. Zero rows means the read failed, not that the file was empty.
        raise InvalidInput("Gemini returned no records for this document", "EXTRACT_EMPTY")

    log.info("parsed records from gemini", extra={"records": len(records), "fields": len(schema.fields)})
    return records


def _find(text: str) -> list[Any] | None:
    """The list of records, whether it arrived bare or wrapped in an object."""
    direct = parse_direct(text)
    found = _as_records(direct)
    if found is not None:
        return found

    for value in scan(text, "{["):
        found = _as_records(value)
        if found is not None:
            return found
    return None


def _as_records(value: Any) -> list[Any] | None:
    if isinstance(value, list):
        return value if all(isinstance(item, dict) for item in value) else None
    if isinstance(value, dict):
        for key in RECORD_KEYS:
            inner = value.get(key)
            if isinstance(inner, list) and all(isinstance(item, dict) for item in inner):
                return inner
    return None
