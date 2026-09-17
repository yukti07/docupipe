from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, Field

from .errors import InvalidInput


class PubSubMessage(BaseModel):
    data: str
    messageId: str | None = None
    attributes: dict[str, str] = Field(default_factory=dict)


class PubSubEnvelope(BaseModel):
    message: PubSubMessage
    subscription: str | None = None
    deliveryAttempt: int | None = None


class SchemaDetectionRequest(BaseModel):
    eventType: Literal["SCHEMA_DETECTION_REQUESTED"]
    requestId: str = Field(min_length=1)
    fileId: str = Field(min_length=1)


class ProcessingRequest(BaseModel):
    eventType: Literal["PROCESSING_REQUESTED"]
    requestId: str = Field(min_length=1)
    fileId: str = Field(min_length=1)
    processingRunId: str = Field(min_length=1)
    fileSchemaVersionId: str = Field(min_length=1)


@dataclass(frozen=True)
class WorkerEvent:
    """What the worker actually needs, from whichever shape arrived.

    The backend publishes the minimum — `{"fileId": "..."}` — and carries
    `requestId` / `userId` / `requestTraceId` as Pub/Sub *attributes*, because
    the file row is the authority on everything else and an id duplicated into
    a message is an id that can disagree with it. Hand-published test events
    and the richer contract in docs/ carry the same fields in the body.

    Both are accepted. `fileId` is the only thing that must be present, and the
    body wins over an attribute when they disagree.
    """

    file_id: str
    request_id: str | None = None
    user_id: str | None = None
    event_type: str | None = None
    processing_run_id: str | None = None
    file_schema_version_id: str | None = None
    message_id: str = ""
    delivery_attempt: int = 0
    request_trace_id: str | None = None


def _pick(body: dict[str, Any], attributes: dict[str, str], *names: str) -> str | None:
    for name in names:
        value = body.get(name) or attributes.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def decode_event(payload: dict[str, Any]) -> WorkerEvent:
    """Parse a push envelope into a WorkerEvent.

    Raises InvalidInput for anything unusable. A malformed message cannot
    become well-formed on redelivery, so the caller answers 200 and lets it
    go rather than burning the delivery budget on it.
    """
    try:
        envelope = PubSubEnvelope.model_validate(payload)
        body = json.loads(base64.b64decode(envelope.message.data, validate=True))
    except Exception as exc:
        raise InvalidInput("Malformed Pub/Sub envelope", "INVALID_PUBSUB_MESSAGE") from exc

    if not isinstance(body, dict):
        raise InvalidInput("Event payload is not an object", "INVALID_PUBSUB_MESSAGE")

    attributes = envelope.message.attributes or {}
    file_id = _pick(body, attributes, "fileId", "file_id")
    if not file_id:
        raise InvalidInput("Event payload has no fileId", "INVALID_PUBSUB_MESSAGE")

    return WorkerEvent(
        file_id=file_id,
        request_id=_pick(body, attributes, "requestId", "request_id"),
        user_id=_pick(body, attributes, "userId", "user_id"),
        event_type=_pick(body, attributes, "eventType", "event_type"),
        processing_run_id=_pick(body, attributes, "processingRunId", "processing_run_id"),
        file_schema_version_id=_pick(body, attributes, "fileSchemaVersionId", "file_schema_version_id"),
        message_id=envelope.message.messageId or "",
        delivery_attempt=envelope.deliveryAttempt or 0,
        request_trace_id=attributes.get("requestTraceId"),
    )


def decode_envelope(payload: dict[str, Any], model: type[BaseModel]) -> BaseModel:
    """Strict decoding against one of the documented event models."""
    try:
        envelope = PubSubEnvelope.model_validate(payload)
        decoded = base64.b64decode(envelope.message.data, validate=True)
        return model.model_validate_json(decoded)
    except Exception as exc:
        raise InvalidInput("Malformed Pub/Sub envelope", "INVALID_PUBSUB_MESSAGE") from exc


def encode_envelope(event: BaseModel | dict[str, Any], attributes: dict[str, str] | None = None) -> dict[str, Any]:
    raw = event.model_dump_json() if isinstance(event, BaseModel) else json.dumps(event)
    return {"message": {"data": base64.b64encode(raw.encode()).decode(), "attributes": attributes or {}}}
