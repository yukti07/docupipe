"""Translating a worker error into the backend's `failure_class` enum.

`files.failure_class` and `file_schema_results.failure_class` are a PostgreSQL
enum owned by the backend migration. Writing anything outside it is not a bad
value that lands anyway — it is `invalid input value for enum failure_class`,
which aborts the transaction. Because the write happens inside an exception
handler, the database error then replaces the real one and the message is
retried to exhaustion for a reason nobody can see.

So every DomainError code has to arrive here and leave as one of these.
"""

from __future__ import annotations

#: The enum, exactly as the backend migration declares it. The contract test
#: reads the migration and compares, so a value added there fails here first.
FAILURE_CLASSES = frozenset({
    "acquisition", "empty_file", "too_large", "archive_not_expanded",
    "format_unsupported", "format_corrupt", "format_locked",
    "extract_empty", "schema_not_found", "schema_inference_failed",
    "provider_quota_exhausted", "provider_refused", "response_unparseable",
    "budget_exceeded",
    "field_unresolved", "field_unsupported_by_evidence", "verification_failed",
    "gate_not_met", "merge_incompatible",
    "processing_failed", "max_attempts", "internal",
})

_BY_CODE: dict[str, str] = {
    # the object
    "FILE_NOT_FOUND": "acquisition",
    "OBJECT_NOT_FOUND": "acquisition",
    "EMPTY_FILE": "empty_file",
    "MAX_RECORDS_EXCEEDED": "too_large",
    "FILE_TOO_LARGE": "too_large",
    # its format
    "UNSUPPORTED_MIME_TYPE": "format_unsupported",
    "INVALID_INPUT": "format_corrupt",
    "EXTRACT_EMPTY": "extract_empty",
    # its shape
    "SCHEMA_NOT_FOUND": "schema_not_found",
    "SCHEMA_INFERENCE_FAILED": "schema_inference_failed",
    # what the model said, when it is the model that failed rather than the file
    "GEMINI_FILE_TOO_LARGE": "too_large",
    "GEMINI_REQUEST_FAILED": "provider_refused",
    "GEMINI_EMPTY_RESPONSE": "provider_refused",
    "GEMINI_JSON_INVALID": "response_unparseable",
    "GEMINI_RESPONSE_TRUNCATED": "too_large",
    "GEMINI_REQUEST_REFUSED": "provider_refused",
    "GEMINI_RECORDS_INVALID": "response_unparseable",
    "GEMINI_SCHEMA_INVALID": "schema_inference_failed",
    # converting it
    "TYPE_COERCION_FAILED": "field_unresolved",
    "VALIDATION_FAILED": "verification_failed",
    "PROCESSING_FAILED": "processing_failed",
    "MAX_ATTEMPTS": "max_attempts",
}


def failure_class(code: str | None) -> str:
    """The enum value for a DomainError code.

    Anything unmapped becomes `internal` rather than raising: a worker that
    crashes while recording why it crashed tells nobody anything.
    """
    if not code:
        return "internal"
    mapped = _BY_CODE.get(code.upper())
    if mapped:
        return mapped
    # A code that is already an enum value passes through, which keeps a
    # caller that knows exactly what it means from having to round-trip.
    lowered = code.lower()
    return lowered if lowered in FAILURE_CLASSES else "internal"
