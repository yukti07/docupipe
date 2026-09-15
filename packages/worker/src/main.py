"""The worker's HTTP surface.

One image, two roles (§26). `SERVICE_ROLE` decides which processor runs; every
route below is identical in both.

    POST /                  Pub/Sub push envelope
    POST /internal/sweep    Cloud Scheduler
    GET  /health            liveness
    GET  /readyz            readiness
    GET  /healthz           queue and outbox state

Cloud Run protects all of them with IAM; nothing here does its own auth.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from . import health, logging_setup, pipeline, subscriber, sweep
from .config import get_config
from .publisher import LocalPublisher, get_publisher
from .pubsub_handler import InvalidEnvelope, parse

log = logging.getLogger(__name__)

_subscriber: subscriber.PullSubscriber | None = None

cfg = get_config()
logging_setup.configure(cfg.log_level)

app = FastAPI(
    title=f"Quarry {cfg.role.value} worker",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.on_event("startup")
def _startup() -> None:
    log.info(
        "worker starting",
        extra={
            "role": cfg.role.value,
            "version": cfg.version,
            "storage": cfg.storage_backend.value,
            "instanceId": cfg.instance_id,
        },
    )

    # In local mode one process is both roles and there is no broker, so wire
    # the local publisher's topics straight to the handler. This is what makes
    # `docker compose up` run the whole pipeline with no cloud account.
    publisher = get_publisher(cfg)
    if isinstance(publisher, LocalPublisher):
        publisher.register(cfg.topic_file_uploaded, _handle_local_delivery)
        publisher.register(cfg.topic_convert_requested, _handle_local_delivery)
        log.info("local publisher wired to both topics")

    # Real Pub/Sub, but nothing can push to this process: open a streaming
    # pull instead. Same parser, same pipeline — only the transport differs.
    if cfg.pubsub_delivery == "pull":
        global _subscriber
        _subscriber = subscriber.PullSubscriber(cfg)
        _subscriber.start()


@app.on_event("shutdown")
def _shutdown() -> None:
    global _subscriber
    if _subscriber is not None:
        _subscriber.stop()
        _subscriber = None


def _handle_local_delivery(file_id: str) -> None:
    # No role juggling: running as BOTH, the file row decides.
    pipeline.handle(file_id, cfg)


@app.post("/")
async def push(request: Request) -> Response:
    """Pub/Sub push.

    The status codes here are the contract in §31.1, and the unusual one is
    deliberate: an unprocessable message is ACKED (200), because nacking a
    message that can never succeed only burns redeliveries until the
    dead-letter policy fires. Nack (409) only when retrying later could
    plausibly work — which is exactly the live-lease case.
    """
    logging_setup.clear()

    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        log.error("push body is not JSON")
        return JSONResponse({"status": "ignored", "reason": "not json"}, status_code=200)

    try:
        envelope = parse(body)
    except InvalidEnvelope as exc:
        log.error("invalid envelope: %s", exc)
        return JSONResponse({"status": "ignored", "reason": str(exc)}, status_code=200)

    logging_setup.bind(
        fileId=envelope.file_id,
        requestId=envelope.request_id,
        userId=envelope.user_id,
        requestTraceId=envelope.request_trace_id,
        role=cfg.role.value,
        deliveryAttempt=envelope.delivery_attempt or None,
    )

    result = pipeline.handle(envelope.file_id, cfg)
    return JSONResponse(
        {
            "status": result.outcome.value,
            "fileId": result.file_id,
            "detail": result.detail or None,
        },
        status_code=result.http_status,
    )


@app.post("/internal/sweep")
async def run_sweep() -> Response:
    """Cloud Scheduler, every minute.

    Not optional: it is the only recovery path for a failed publish, a dead
    worker's lease, and a request parked on a limit.
    """
    logging_setup.clear()
    logging_setup.bind(role=cfg.role.value, trigger="scheduler")
    report = sweep.run(cfg)
    return JSONResponse({"status": "ok", **report}, status_code=200)


@app.get("/health")
async def liveness() -> Response:
    return JSONResponse(health.liveness(), status_code=200)


@app.get("/readyz")
async def readiness() -> Response:
    body, status = health.readiness(cfg)
    return JSONResponse(body, status_code=status)


@app.get("/healthz")
async def deep_health() -> Response:
    body, status = health.deep(cfg)
    return JSONResponse(body, status_code=status)
