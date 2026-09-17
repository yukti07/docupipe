"""Publishing to Pub/Sub.

Only the sweep publishes. Normal events come from the backend; the worker
publishes when it is recovering — relaying an outbox row whose inline publish
failed, or putting a reclaimed file back on its topic.
"""

from __future__ import annotations

import json
import logging

log = logging.getLogger(__name__)


class PubSubPublisher:
    def __init__(self, project_id: str):
        if not project_id: raise RuntimeError("ZAMP_GCP_PROJECT_ID is required to publish")
        self.project_id, self._client = project_id, None

    @property
    def client(self):
        # Lazy for the same reason as the storage client: resolving credentials
        # at import time turns a config problem into a startup crash that names
        # the wrong thing.
        if self._client is None:
            from google.cloud import pubsub_v1  # noqa: PLC0415
            self._client = pubsub_v1.PublisherClient()
        return self._client

    def publish(self, topic: str, payload: dict, attributes: dict[str, str] | None = None) -> str:
        path = self.client.topic_path(self.project_id, topic)
        future = self.client.publish(path, json.dumps(payload).encode("utf-8"), **(attributes or {}))
        # Block: the outbox row is only marked PUBLISHED once the broker has
        # accepted it. Fire-and-forget would record a success we do not have.
        return future.result(timeout=30)


class NullPublisher:
    """Records calls and does nothing. For tests that assert on publishes."""

    def __init__(self) -> None: self.published: list[tuple[str, dict, dict]] = []

    def publish(self, topic: str, payload: dict, attributes: dict[str, str] | None = None) -> str:
        self.published.append((topic, payload, attributes or {}))
        return f"null-{len(self.published)}"
