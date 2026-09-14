"""Pure-logic tests. No database, so these run anywhere."""

from __future__ import annotations

import pytest

from src import failures, shapes
from src.pubsub_handler import InvalidEnvelope, encode, parse


# ---------------------------------------------------------------- shapes


def test_shape_hash_ignores_field_order():
    a = [shapes.make_field("total", type_="number"), shapes.make_field("id")]
    b = [shapes.make_field("id"), shapes.make_field("total", type_="number")]
    assert shapes.shape_hash(a) == shapes.shape_hash(b)


def test_shape_hash_changes_with_type():
    a = [shapes.make_field("invoice_no", type_="text")]
    b = [shapes.make_field("invoice_no", type_="number")]
    assert shapes.shape_hash(a) != shapes.shape_hash(b)
    assert not shapes.same_shape(a, b)


def test_shape_hash_ignores_labels_and_required():
    """Only name and type decide whether two tables share a shape — the same
    rule the merge check uses, so the two cannot disagree."""
    a = [shapes.make_field("total", label="Total", type_="number", required=True)]
    b = [shapes.make_field("total", label="Grand Total", type_="number")]
    assert shapes.shape_hash(a) == shapes.shape_hash(b)


def test_unknown_field_type_is_refused():
    with pytest.raises(ValueError):
        shapes.make_field("x", type_="blob")


# -------------------------------------------------------------- failures


def test_every_class_has_a_sentence_and_a_next_step():
    for cls in failures.FailureClass:
        spec = failures.spec(cls)
        assert spec.message and spec.message[0].isupper()
        assert spec.next_step


def test_non_retryable_classes_are_not_retried():
    """Retrying a password-protected PDF four times burns quota to reach the
    same answer."""
    assert not failures.is_retryable(failures.FailureClass.FORMAT_LOCKED)
    assert not failures.is_retryable(failures.FailureClass.EMPTY_FILE)
    assert not failures.is_retryable(failures.FailureClass.TOO_LARGE)
    assert failures.is_retryable(failures.FailureClass.PROCESSING_FAILED)


def test_unknown_exceptions_become_internal_not_a_stack_trace():
    cls, detail = failures.classify(KeyError("secret-ish thing"))
    assert cls is failures.FailureClass.INTERNAL
    assert "KeyError" in detail


def test_a_classified_failure_keeps_its_class():
    exc = failures.QuarryFailure(failures.FailureClass.FORMAT_LOCKED, "locked")
    cls, detail = failures.classify(exc)
    assert cls is failures.FailureClass.FORMAT_LOCKED
    assert detail == "locked"


def test_error_envelope_is_one_shape():
    payload = failures.to_payload(failures.FailureClass.TOO_LARGE)
    assert set(payload) == {"class", "message", "nextStep"}


# -------------------------------------------------------------- envelope


def test_parse_a_real_envelope():
    body = encode({"fileId": "file_7a2"}, {"userId": "usr_1", "requestTraceId": "req_x"})
    env = parse(body)
    assert env.file_id == "file_7a2"
    assert env.user_id == "usr_1"
    assert env.request_trace_id == "req_x"


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"message": {}},
        {"message": {"data": ""}},
        {"message": {"data": "not-base64!!"}},
        {"message": {"data": "eyJub3BlIjoxfQ=="}},   # valid JSON, no fileId
        {"message": {"data": "bm90IGpzb24="}},       # valid base64, not JSON
    ],
)
def test_bad_envelopes_are_rejected_clearly(body):
    """Every one of these is answered 200 by the caller: a malformed message
    cannot become well-formed on redelivery."""
    with pytest.raises(InvalidEnvelope):
        parse(body)


def test_delivery_attempt_is_carried_through():
    body = encode({"fileId": "f"})
    body["deliveryAttempt"] = 3
    assert parse(body).delivery_attempt == 3
