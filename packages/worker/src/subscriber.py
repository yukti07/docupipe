"""Pull delivery, for a worker that Pub/Sub cannot reach.

Deployed, Cloud Run gets a PUSH subscription and `main.py`'s `POST /` is the
whole delivery path. A worker running on a laptop has no public URL, so a real
topic can be published to and nothing ever arrives — the pipeline stalls
silently, which is the worst possible failure shape.

This opens a streaming pull instead. It is deliberately NOT a second code path:
a pulled message is re-shaped into the same push envelope `pubsub_handler.parse`
already validates, and handed to the same `pipeline.handle`. The only thing
that differs is how the bytes got here, and how the outcome is signalled —
ack/nack rather than a status code.

Gated behind PUBSUB_DELIVERY=pull so a deployed instance cannot start pulling
by accident and race its own push subscription.
"""

from __future__ import annotations

import base64
import logging
import threading

from . import logging_setup, pipeline
from .config import Config, ServiceRole
from .pubsub_handler import InvalidEnvelope, parse

log = logging.getLogger(__name__)

#: One in flight per subscription. A local worker is one process with a small
#: pool, and the lease makes extra concurrency pointless — a second message for
#: the same file would only bounce off LEASE_HELD.
_MAX_IN_FLIGHT = 1


def subscriptions_for(cfg: Config) -> list[tuple[str, str]]:
    """(subscription, topic) pairs this role is responsible for."""
    pairs: list[tuple[str, str]] = []
    if cfg.role in (ServiceRole.INSPECT, ServiceRole.BOTH):
        pairs.append((cfg.subscription_file_uploaded, cfg.topic_file_uploaded))
    if cfg.role in (ServiceRole.CONVERT, ServiceRole.BOTH):
        pairs.append((cfg.subscription_convert_requested, cfg.topic_convert_requested))
    return pairs


class PullSubscriber:
    def __init__(self, cfg: Config) -> None:
        if not cfg.project_id:
            raise RuntimeError("GCP_PROJECT_ID is required for PUBSUB_DELIVERY=pull")
        self._cfg = cfg
        self._client = None
        self._futures: list = []
        self._lock = threading.Lock()

    def start(self) -> None:
        from google.cloud import pubsub_v1  # noqa: PLC0415

        self._client = pubsub_v1.SubscriberClient()
        flow = pubsub_v1.types.FlowControl(max_messages=_MAX_IN_FLIGHT)

        for subscription, topic in subscriptions_for(self._cfg):
            path = self._client.subscription_path(self._cfg.project_id, subscription)
            future = self._client.subscribe(
                path, callback=self._make_callback(topic), flow_control=flow
            )
            with self._lock:
                self._futures.append(future)
            log.info("pulling %s (topic %s)", path, topic)

    def stop(self) -> None:
        with self._lock:
            futures, self._futures = self._futures, []
        for future in futures:
            future.cancel()
        for future in futures:
            try:
                future.result(timeout=10)
            except Exception:  # noqa: BLE001  — cancellation surfaces as an error
                pass
        if self._client is not None:
            self._client.close()
            self._client = None

    def _make_callback(self, topic: str):
        def callback(message) -> None:
            logging_setup.clear()

            # Re-shaped into a push envelope so validation stays in one place.
            body = {
                "message": {
                    "data": base64.b64encode(message.data).decode(),
                    "attributes": dict(message.attributes or {}),
                    "messageId": message.message_id,
                },
                "subscription": topic,
                "deliveryAttempt": message.delivery_attempt or 0,
            }

            try:
                envelope = parse(body)
            except InvalidEnvelope as exc:
                # Ack: a malformed message cannot become well-formed on
                # redelivery, and nacking only burns attempts (§31.1).
                log.error("invalid envelope, acking: %s", exc)
                message.ack()
                return

            logging_setup.bind(
                fileId=envelope.file_id,
                requestId=envelope.request_id,
                userId=envelope.user_id,
                requestTraceId=envelope.request_trace_id,
                role=self._cfg.role.value,
                deliveryAttempt=envelope.delivery_attempt or None,
                delivery="pull",
            )

            try:
                result = pipeline.handle(envelope.file_id, self._cfg)
            except Exception:  # noqa: BLE001
                # Unhandled means we do not know that a retry cannot help.
                log.exception("handler raised, nacking %s", envelope.file_id)
                message.nack()
                return

            # The same rule the push route encodes as a status code: nack only
            # when retrying later could plausibly work, which is the live-lease
            # case alone.
            if result.http_status == 409:
                message.nack()
            else:
                message.ack()

        return callback
