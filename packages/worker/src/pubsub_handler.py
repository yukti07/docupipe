"""Parsing a Pub/Sub push envelope.

Shared by both services — the envelope is identical on either topic, and the
body is a single key. Which topic a message arrived on says which service it
is, not what to do; the file row says that.
"""

from __future__ import annotations

import base64
import binascii
import json
from dataclasses import dataclass, field


class InvalidEnvelope(ValueError):
    """The body is not a Pub/Sub push envelope we can act on.

    This is always answered with 200. A malformed message cannot become
    well-formed on redelivery, so nacking it only burns attempts until the
    dead-letter policy fires.
    """


@dataclass(frozen=True)
class Envelope:
    file_id: str
    message_id: str = ""
    delivery_attempt: int = 0
    attributes: dict[str, str] = field(default_factory=dict)

    @property
    def request_trace_id(self) -> str | None:
        return self.attributes.get("requestTraceId")

    @property
    def user_id(self) -> str | None:
        return self.attributes.get("userId")

    @property
    def request_id(self) -> str | None:
        return self.attributes.get("requestId")


def parse(body: dict) -> Envelope:
    if not isinstance(body, dict):
        raise InvalidEnvelope("body is not an object")

    message = body.get("message")
    if not isinstance(message, dict):
        raise InvalidEnvelope("no `message` in the envelope")

    raw = message.get("data")
    if not raw:
        raise InvalidEnvelope("`message.data` is empty")

    try:
        decoded = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise InvalidEnvelope("`message.data` is not valid base64") from exc

    try:
        payload = json.loads(decoded)
    except json.JSONDecodeError as exc:
        raise InvalidEnvelope("`message.data` is not valid JSON") from exc

    if not isinstance(payload, dict):
        raise InvalidEnvelope("payload is not an object")

    file_id = payload.get("fileId")
    if not isinstance(file_id, str) or not file_id.strip():
        raise InvalidEnvelope("payload has no `fileId`")

    attributes = message.get("attributes") or {}
    if not isinstance(attributes, dict):
        attributes = {}

    return Envelope(
        file_id=file_id.strip(),
        message_id=str(message.get("messageId") or message.get("message_id") or ""),
        delivery_attempt=int(body.get("deliveryAttempt") or 0),
        attributes={str(k): str(v) for k, v in attributes.items()},
    )


def encode(payload: dict, attributes: dict[str, str] | None = None) -> dict:
    """Build an envelope. Used by tests and by the local publisher."""
    return {
        "message": {
            "data": base64.b64encode(json.dumps(payload).encode()).decode(),
            "attributes": attributes or {},
            "messageId": "synthetic",
        },
        "subscription": "projects/local/subscriptions/synthetic",
    }
