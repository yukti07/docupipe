"""Publishing to Pub/Sub, behind the same interface discipline as storage.

Two implementations:

  * PubSubPublisher  — deployed
  * LocalPublisher   — writes the message back into request_outbox's sibling
                       log and returns, so `docker compose` runs the whole
                       pipeline with no broker

The local one is not a mock in the test sense: it is a real implementation of
a degraded environment, and the sweep genuinely drives the pipeline through it.
"""

from __future__ import annotations

import json
import logging
import threading
from typing import Callable

from .config import Config, StorageBackend

log = logging.getLogger(__name__)


class PubSubPublisher:
    def __init__(self, project_id: str):
        if not project_id:
            raise RuntimeError("GCP_PROJECT_ID is required to publish")
        self.project_id = project_id
        self._client = None

    @property
    def client(self):
        # Lazy for the same reason as the storage client: resolving
        # credentials at import time turns a config problem into a startup
        # crash that names the wrong thing.
        if self._client is None:
            from google.cloud import pubsub_v1  # noqa: PLC0415

            self._client = pubsub_v1.PublisherClient()
        return self._client

    def publish(self, topic: str, payload: dict, attributes: dict[str, str]) -> str:
        path = self.client.topic_path(self.project_id, topic)
        data = json.dumps(payload).encode("utf-8")
        future = self.client.publish(path, data, **attributes)
        # Block: the outbox row is only marked PUBLISHED once the broker has
        # actually accepted it. A fire-and-forget publish would let us record
        # a success we do not have.
        return future.result(timeout=30)


class LocalPublisher:
    """Delivers in-process, on a background thread.

    `docker compose` runs one container that is both roles, so a message
    published to either topic is handed straight to the matching handler.
    Delivery is asynchronous so the publish call cannot deadlock on the
    transaction that produced it.
    """

    def __init__(self) -> None:
        self._handlers: dict[str, Callable[[str], None]] = {}
        self._counter = 0
        self._lock = threading.Lock()

    def register(self, topic: str, handler: Callable[[str], None]) -> None:
        self._handlers[topic] = handler

    def publish(self, topic: str, payload: dict, attributes: dict[str, str]) -> str:
        with self._lock:
            self._counter += 1
            message_id = f"local-{self._counter}"

        handler = self._handlers.get(topic)
        log.info(
            "local publish",
            extra={"topic": topic, "payload": payload, "delivered": bool(handler)},
        )
        if handler is not None:
            file_id = payload.get("fileId")
            if file_id:
                threading.Thread(
                    target=_safe_call, args=(handler, file_id), daemon=True
                ).start()
        return message_id


def _safe_call(handler: Callable[[str], None], file_id: str) -> None:
    try:
        handler(file_id)
    except Exception:  # noqa: BLE001 - a background thread must not die silently
        log.exception("local delivery failed", extra={"fileId": file_id})


class NullPublisher:
    """Records calls and does nothing. For tests that assert on publishes."""

    def __init__(self) -> None:
        self.published: list[tuple[str, dict, dict]] = []

    def publish(self, topic: str, payload: dict, attributes: dict[str, str]) -> str:
        self.published.append((topic, payload, attributes))
        return f"null-{len(self.published)}"


_publisher = None


def get_publisher(cfg: Config):
    global _publisher
    if _publisher is not None:
        return _publisher
    if cfg.storage_backend is StorageBackend.LOCAL:
        _publisher = LocalPublisher()
    else:
        _publisher = PubSubPublisher(cfg.project_id)
    return _publisher


def set_publisher(publisher) -> None:
    """Inject a publisher. Used by tests; not used in production code."""
    global _publisher
    _publisher = publisher
