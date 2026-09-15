"""Pull delivery.

The ack/nack rule is the whole contract, and it is the same one the push route
encodes as a status code: nack ONLY when retrying could plausibly work. Acking
an unprocessable message is deliberate — nacking it burns redeliveries until
the dead-letter policy fires.
"""

from __future__ import annotations

import base64
import json

import pytest

from src import subscriber
from src.config import ServiceRole
from src.leases import ClaimOutcome
from src.pipeline import Result

from .conftest import make_config


class FakeMessage:
    def __init__(self, payload: dict | None = None, *, raw: bytes | None = None):
        self.data = raw if raw is not None else json.dumps(payload).encode()
        self.attributes = {"userId": "usr_x", "requestId": "req_x"}
        self.message_id = "m-1"
        self.delivery_attempt = 1
        self.acked = False
        self.nacked = False

    def ack(self) -> None:
        self.acked = True

    def nack(self) -> None:
        self.nacked = True


def _callback(monkeypatch, outcome: ClaimOutcome | None, *, raises: bool = False):
    cfg = make_config(role=ServiceRole.BOTH, project_id="p")

    def handle(file_id, _cfg):
        if raises:
            raise RuntimeError("boom")
        return Result(outcome=outcome, file_id=file_id)

    monkeypatch.setattr(subscriber.pipeline, "handle", handle)
    return subscriber.PullSubscriber(cfg)._make_callback("file-uploaded")


@pytest.mark.parametrize(
    "outcome",
    [
        ClaimOutcome.CLAIMED,
        ClaimOutcome.ALREADY_DONE,
        ClaimOutcome.TERMINAL,
        ClaimOutcome.EXHAUSTED,
        ClaimOutcome.NOT_FOUND,
    ],
)
def test_anything_a_retry_cannot_help_is_acked(monkeypatch, outcome):
    message = FakeMessage({"fileId": "file_1"})
    _callback(monkeypatch, outcome)(message)
    assert message.acked and not message.nacked


def test_a_live_lease_is_nacked_so_it_comes_back(monkeypatch):
    message = FakeMessage({"fileId": "file_1"})
    _callback(monkeypatch, ClaimOutcome.LEASE_HELD)(message)
    assert message.nacked and not message.acked


def test_an_unhandled_exception_is_nacked(monkeypatch):
    message = FakeMessage({"fileId": "file_1"})
    _callback(monkeypatch, None, raises=True)(message)
    assert message.nacked and not message.acked


def test_a_malformed_payload_is_acked_not_retried(monkeypatch):
    message = FakeMessage(raw=b"not json at all")
    _callback(monkeypatch, ClaimOutcome.CLAIMED)(message)
    assert message.acked and not message.nacked


def test_the_pulled_message_is_parsed_as_a_push_envelope(monkeypatch):
    """Pull and push must not drift into two parsers."""
    seen: dict = {}

    cfg = make_config(role=ServiceRole.BOTH, project_id="p")
    def handle(file_id, _cfg):
        seen["fileId"] = file_id
        return Result(outcome=ClaimOutcome.CLAIMED, file_id=file_id)

    monkeypatch.setattr(subscriber.pipeline, "handle", handle)

    message = FakeMessage({"fileId": "file_42"})
    subscriber.PullSubscriber(cfg)._make_callback("file-uploaded")(message)

    assert seen["fileId"] == "file_42"
    # base64 round-trip is what `parse` does; prove the shape we build matches.
    assert json.loads(base64.b64decode(base64.b64encode(message.data)))["fileId"] == "file_42"


@pytest.mark.parametrize(
    "role,expected",
    [
        (ServiceRole.INSPECT, ["file-uploaded-local"]),
        (ServiceRole.CONVERT, ["convert-requested-local"]),
        (ServiceRole.BOTH, ["file-uploaded-local", "convert-requested-local"]),
    ],
)
def test_each_role_pulls_only_its_own_subscription(role, expected):
    cfg = make_config(role=role, project_id="p")
    assert [s for s, _ in subscriber.subscriptions_for(cfg)] == expected


def test_pull_without_a_project_id_fails_loudly():
    with pytest.raises(RuntimeError, match="GCP_PROJECT_ID"):
        subscriber.PullSubscriber(make_config(project_id=""))
