"""A spent quota is a verdict, not a blip.

Gemini answers 429 for two unrelated situations, and the difference decides
whether the file should be retried or settled:

  * a per-MINUTE rate limit — the next minute genuinely works, so the work is
    still valid and the file must be left for the reaper;
  * a per-DAY allowance — nothing changes until the quota resets, so retrying
    only churns the file through the pipeline until it exhausts its attempts
    and settles as `max_attempts`, telling the user nothing about why.

The second is what `provider_quota_exhausted` exists for.
"""

from __future__ import annotations

import io
import json
import urllib.error

import pytest

from zamp_shared.errors import DomainError, TransientError
from zamp_shared.failures import failure_class
from zamp_shared.llm import GeminiClient
from zamp_shared import llm as llm_module


def _quota_body(quota_id: str) -> bytes:
    """The body Gemini actually returns, verbatim in shape and in length.

    The length matters: the violation that names the quota sits past the 512th
    character, after the prose message and the Help block. A reader that only
    keeps the first 512 bytes — which is all the log ever needed — cannot see
    which quota was hit.
    """
    return json.dumps({
        "error": {
            "code": 429,
            "message": (
                "You exceeded your current quota, please check your plan and billing details. "
                "For more information on this error, head to: "
                "https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current "
                "usage, head to: https://ai.dev/rate-limit. \n* Quota exceeded for metric: "
                "generativelanguage.googleapis.com/generate_content_free_tier_requests, "
                "limit: 20, model: gemini-3.6-flash\nPlease retry in 37.787535557s."
            ),
            "status": "RESOURCE_EXHAUSTED",
            "details": [
                {"@type": "type.googleapis.com/google.rpc.Help",
                 "links": [{"description": "Learn more about Gemini API quotas",
                            "url": "https://ai.google.dev/gemini-api/docs/rate-limits"}]},
                {"@type": "type.googleapis.com/google.rpc.QuotaFailure",
                 "violations": [{
                     "quotaMetric": "generativelanguage.googleapis.com/generate_content_free_tier_requests",
                     "quotaId": quota_id,
                     "quotaDimensions": {"model": "gemini-3.6-flash", "location": "global"},
                     "quotaValue": "20"}]},
                {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "37s"},
            ],
        }
    }).encode()


def _raises(body: bytes, status: int = 429):
    """A urlopen that always fails the same way, counting how often it is asked."""
    calls = {"n": 0}

    def fake_urlopen(request, timeout=None):  # noqa: ARG001
        calls["n"] += 1
        raise urllib.error.HTTPError(
            "https://generativelanguage.googleapis.com/", status, "Too Many Requests",
            {}, io.BytesIO(body))

    return fake_urlopen, calls


def _client(monkeypatch: pytest.MonkeyPatch, body: bytes, status: int = 429):
    fake, calls = _raises(body, status)
    monkeypatch.setattr(llm_module.urllib.request, "urlopen", fake)
    # No real sleeping: the backoff is not what is under test here.
    return GeminiClient(api_key="k" * 8, sleep=lambda _seconds: None), calls


PER_DAY = "GenerateRequestsPerDayPerProjectPerModel-FreeTier"
PER_MINUTE = "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"


def test_daily_quota_is_permanent(monkeypatch: pytest.MonkeyPatch) -> None:
    client, _ = _client(monkeypatch, _quota_body(PER_DAY))

    with pytest.raises(DomainError) as caught:
        client.generate([{"text": "hi"}])

    assert caught.value.code == "GEMINI_QUOTA_EXHAUSTED"
    # A DomainError is what settles the file and acknowledges the message; a
    # TransientError would put it straight back in the queue.
    assert not isinstance(caught.value, TransientError)


def test_daily_quota_is_not_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    client, calls = _client(monkeypatch, _quota_body(PER_DAY))

    with pytest.raises(DomainError):
        client.generate([{"text": "hi"}])

    # Three further attempts against an allowance that is spent until tomorrow
    # buy nothing and cost a minute of the lease.
    assert calls["n"] == 1


def test_per_minute_quota_is_still_transient(monkeypatch: pytest.MonkeyPatch) -> None:
    client, calls = _client(monkeypatch, _quota_body(PER_MINUTE))

    with pytest.raises(TransientError) as caught:
        client.generate([{"text": "hi"}])

    assert caught.value.code == "GEMINI_UNAVAILABLE"
    assert calls["n"] == 4  # the original plus max_retries


def test_unreadable_429_stays_transient(monkeypatch: pytest.MonkeyPatch) -> None:
    # Guessing "permanent" from a body we could not parse would settle a file
    # FAILED for what may well have been a momentary rate limit.
    client, calls = _client(monkeypatch, b"<html>rate limited</html>")

    with pytest.raises(TransientError):
        client.generate([{"text": "hi"}])

    assert calls["n"] == 4


def test_other_statuses_are_unaffected(monkeypatch: pytest.MonkeyPatch) -> None:
    client, calls = _client(monkeypatch, b"{}", status=503)

    with pytest.raises(TransientError):
        client.generate([{"text": "hi"}])

    assert calls["n"] == 4


def test_the_code_reaches_the_backend_enum() -> None:
    # The whole point: this is the value written to files.failure_class, and
    # anything outside the enum aborts the transaction that records it.
    assert failure_class("GEMINI_QUOTA_EXHAUSTED") == "provider_quota_exhausted"
