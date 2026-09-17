class DomainError(Exception):
    """Known permanent processing error; Pub/Sub handlers acknowledge these."""

    code = "DOMAIN_ERROR"

    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        if code:
            self.code = code


class TransientError(Exception):
    """A dependency was briefly unavailable; the work is still valid.

    Deliberately not a DomainError. Settling the file on one of these writes
    FAILED for a condition that would have succeeded a minute later, and since
    only an UPLOADED file can be claimed, that verdict is final. Leaving the row
    untouched lets the lease lapse and the reaper hand it back.
    """

    code = "TRANSIENT"

    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        if code:
            self.code = code


class UnsupportedMimeType(DomainError):
    code = "UNSUPPORTED_MIME_TYPE"


class InvalidInput(DomainError):
    code = "INVALID_INPUT"


class SchemaNotApproved(DomainError):
    code = "SCHEMA_NOT_APPROVED"

