"""The closed failure list.

Every failure has a class, a sentence a person can act on, and a defined next
step. This module is the ONLY place a class becomes text on the worker side;
the frontend has exactly one counterpart in `lib/failures.ts`. If anything
else builds a message from an exception, that is a bug regardless of how good
the message reads.

CANONICAL, and mirrored in three places. Change all four together:

    packages/db/prisma/schema.prisma        enum FailureClass
    packages/db/prisma/migrations/…         CREATE TYPE failure_class
    packages/web/src/lib/api/types.ts       type FailureClass
    packages/web/src/lib/api/http.ts        KNOWN

This is product semantics living in two languages, which is exactly the kind
of duplication that drifts without anyone noticing: a class the worker writes
but the client's set omits renders as "unknown", which is a worse sentence
than the one we had.

`network` and `unknown` exist on the client only. The server never sends them.

Two rules live here rather than in the call sites:

  * retryable classes are retried, non-retryable ones dead-letter immediately.
    Retrying a password-protected PDF four times burns quota to reach the same
    answer.

  * `provider_quota_exhausted` and `budget_exceeded` are NOT failures. They
    pause the request with a resume time and the sweep picks it back up. They
    must never mark a file FAILED.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class FailureClass(str, Enum):
    # Acquisition
    ACQUISITION = "acquisition"
    EMPTY_FILE = "empty_file"
    TOO_LARGE = "too_large"
    ARCHIVE_NOT_EXPANDED = "archive_not_expanded"

    # Format
    FORMAT_UNSUPPORTED = "format_unsupported"
    FORMAT_CORRUPT = "format_corrupt"
    FORMAT_LOCKED = "format_locked"

    # Reading a shape
    EXTRACT_EMPTY = "extract_empty"
    SCHEMA_NOT_FOUND = "schema_not_found"
    SCHEMA_INFERENCE_FAILED = "schema_inference_failed"

    # The model, and the allowance
    PROVIDER_QUOTA_EXHAUSTED = "provider_quota_exhausted"
    PROVIDER_REFUSED = "provider_refused"
    RESPONSE_UNPARSEABLE = "response_unparseable"
    BUDGET_EXCEEDED = "budget_exceeded"

    # Per-value, set during verification
    FIELD_UNRESOLVED = "field_unresolved"
    FIELD_UNSUPPORTED_BY_EVIDENCE = "field_unsupported_by_evidence"
    VERIFICATION_FAILED = "verification_failed"

    # API-level only — never stored on a file row
    GATE_NOT_MET = "gate_not_met"
    MERGE_INCOMPATIBLE = "merge_incompatible"

    # Operational — the worker's own failures, not the document's
    PROCESSING_FAILED = "processing_failed"
    MAX_ATTEMPTS = "max_attempts"
    INTERNAL = "internal"


@dataclass(frozen=True)
class FailureSpec:
    message: str
    next_step: str
    retryable: bool
    #: Pauses the request instead of failing the file.
    pauses: bool = False
    #: Only ever appears in an API response, never on a file row.
    api_only: bool = False


#: Copy is kept close to `lib/failures.ts` so the two do not describe the same
#: situation differently. The frontend's wording wins where they differ — it is
#: the one a user actually reads.
_SPECS: dict[FailureClass, FailureSpec] = {
    FailureClass.ACQUISITION: FailureSpec(
        "Upload didn't finish.",
        "Retry this file.",
        retryable=True,
    ),
    FailureClass.EMPTY_FILE: FailureSpec(
        "This file is empty.",
        "Remove it; the rest carry on.",
        retryable=False,
    ),
    FailureClass.TOO_LARGE: FailureSpec(
        "This file is past the size we can read in one go.",
        "Split it, or raise the cap.",
        retryable=False,
    ),
    FailureClass.ARCHIVE_NOT_EXPANDED: FailureSpec(
        "Archives aren't read yet.",
        "Unzip it first and drop the files.",
        retryable=False,
    ),
    FailureClass.FORMAT_UNSUPPORTED: FailureSpec(
        "That format isn't supported.",
        "Save it as PDF, .docx, .xlsx or CSV and upload it again.",
        retryable=False,
    ),
    FailureClass.FORMAT_CORRUPT: FailureSpec(
        "This file says it is one thing but isn't.",
        "Check the file and upload it again.",
        retryable=False,
    ),
    FailureClass.FORMAT_LOCKED: FailureSpec(
        "This PDF is password protected.",
        "Remove the password and upload it again.",
        retryable=False,
    ),
    FailureClass.EXTRACT_EMPTY: FailureSpec(
        "Its pages are images with no readable text.",
        "Remove it, or convert anyway and it will be skipped.",
        retryable=False,
    ),
    FailureClass.SCHEMA_NOT_FOUND: FailureSpec(
        "Couldn't find a table in this one.",
        "Add fields yourself, or leave it out.",
        retryable=False,
    ),
    FailureClass.SCHEMA_INFERENCE_FAILED: FailureSpec(
        "Couldn't work out this file's shape.",
        "Convert anyway and it'll be skipped, or remove it.",
        retryable=True,
    ),
    FailureClass.PROVIDER_QUOTA_EXHAUSTED: FailureSpec(
        "Daily page allowance used up.",
        "Nothing — it picks up on its own, and finished tables stay downloadable.",
        retryable=True,
        pauses=True,
    ),
    FailureClass.PROVIDER_REFUSED: FailureSpec(
        "The model declined to process this document.",
        "Remove it from the batch.",
        retryable=False,
    ),
    FailureClass.RESPONSE_UNPARSEABLE: FailureSpec(
        "Couldn't get a clean answer for this one.",
        "Retry it.",
        retryable=True,
    ),
    FailureClass.BUDGET_EXCEEDED: FailureSpec(
        "You've hit your processing cap.",
        "Raise the cap, or take the tables you have.",
        retryable=True,
        pauses=True,
    ),
    FailureClass.FIELD_UNRESOLVED: FailureSpec(
        "This value isn't in the document.",
        "Nothing — the cell reads “not found” rather than guessing.",
        retryable=False,
    ),
    FailureClass.FIELD_UNSUPPORTED_BY_EVIDENCE: FailureSpec(
        "I couldn't find this value in the document.",
        "Check it against the evidence beside it.",
        retryable=False,
    ),
    FailureClass.VERIFICATION_FAILED: FailureSpec(
        "An automatic check on this value didn't pass.",
        "Check it against the evidence beside it.",
        retryable=False,
    ),
    FailureClass.GATE_NOT_MET: FailureSpec(
        "Some files are still reading their shape.",
        "Wait for them to finish, or remove them.",
        retryable=False,
        api_only=True,
    ),
    FailureClass.MERGE_INCOMPATIBLE: FailureSpec(
        "These tables don't have the same fields and types.",
        "Untick the table named on the card, or merge within its own schema.",
        retryable=False,
        api_only=True,
    ),
    FailureClass.PROCESSING_FAILED: FailureSpec(
        "Something went wrong working through this one.",
        "Retry it; the rest of the batch is unaffected.",
        retryable=True,
    ),
    FailureClass.MAX_ATTEMPTS: FailureSpec(
        "This one failed repeatedly, so we stopped trying.",
        "Remove it, or upload it again.",
        retryable=False,
    ),
    FailureClass.INTERNAL: FailureSpec(
        "Something went wrong on our side.",
        "Retry it — we've logged what happened.",
        retryable=True,
    ),
}


class QuarryFailure(Exception):
    """A failure that already knows its class.

    Raise this from a processor. Anything else that escapes becomes
    `internal`, which is the honest answer for a thing we did not anticipate.
    """

    def __init__(self, failure_class: FailureClass, detail: str | None = None):
        self.failure_class = failure_class
        self.detail = detail
        super().__init__(f"{failure_class.value}: {detail or spec(failure_class).message}")


def spec(failure_class: FailureClass) -> FailureSpec:
    return _SPECS[failure_class]


def is_retryable(failure_class: FailureClass) -> bool:
    return _SPECS[failure_class].retryable


def pauses_request(failure_class: FailureClass) -> bool:
    """True for the classes that park a request rather than failing a file."""
    return _SPECS[failure_class].pauses


def to_payload(failure_class: FailureClass, detail: str | None = None) -> dict:
    """The one error envelope, used everywhere.

    Matches what `http.ts` reads off a non-2xx body.
    """
    s = _SPECS[failure_class]
    return {
        "class": failure_class.value,
        "message": detail or s.message,
        "nextStep": s.next_step,
    }


def classify(exc: BaseException) -> tuple[FailureClass, str]:
    """Turn any exception into a class and a detail string.

    Unrecognised exceptions become `internal` rather than reaching a user as a
    stack trace.
    """
    if isinstance(exc, QuarryFailure):
        return exc.failure_class, exc.detail or spec(exc.failure_class).message
    return FailureClass.INTERNAL, f"{type(exc).__name__}: {exc}"


# Sanity: every member has a spec. A class with no sentence is a class that
# reaches a user as a bare identifier.
_missing = set(FailureClass) - set(_SPECS)
if _missing:  # pragma: no cover - import-time guard
    raise RuntimeError(f"failure classes with no message: {sorted(c.value for c in _missing)}")
