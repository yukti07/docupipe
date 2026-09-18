"""The image detector and the Gemini transport, without touching the network."""
import base64
import io
import json
import urllib.error
from pathlib import Path

import pytest
from PIL import Image

from zamp_shared.domain import SchemaDetectionContext, SourceFile
from zamp_shared.errors import InvalidInput, TransientError, UnsupportedMimeType
from zamp_shared.llm import GeminiClient, PromptRepository

from app.detectors.image import GeminiImageSchemaDetector

PROMPTS = Path(__file__).resolve().parents[1] / "python" / "prompts"

RESPONSE = json.dumps({
    "name": "employees",
    "fields": [{"name": "employee_id", "type": "text", "required": True, "description": "Identifier",
                "aliases": [], "fields": [], "item_type": None, "item_fields": []}],
    "metadata": {"format": "image", "confidence": 0.9, "notes": [], "provider": "gemini"},
})


class StubClient:
    def __init__(self, response=RESPONSE):
        self.response, self.parts = response, None

    def generate(self, parts):
        self.parts = parts
        return self.response


def write_image(path: Path, fmt: str, size=(40, 20)) -> Path:
    Image.new("RGB", size, (250, 250, 250)).save(path, format=fmt)
    return path


def context_for(path: Path, mime_type: str) -> SchemaDetectionContext:
    source = SourceFile(id="file_1", request_id="request_1", user_id="user_1", bucket="b",
                        object_key=f"uploads/{path.name}", filename=path.name,
                        mime_type=mime_type, size_bytes=path.stat().st_size)
    return SchemaDetectionContext(source_file=source, local_path=str(path))


def detector(client, max_image_bytes=14_000_000):
    return GeminiImageSchemaDetector(client, PromptRepository(PROMPTS), max_image_bytes)


# ------------------------------------------------------------- request shape

def test_the_image_is_sent_as_pixels_not_text(tmp_path):
    client = StubClient()
    path = write_image(tmp_path / "table.png", "PNG")
    detector(client).detect(context_for(path, "image/png"))

    inline = client.parts[0]["inline_data"]
    assert base64.b64decode(inline["data"]) == path.read_bytes()
    assert not any("inline_data" not in part and part.get("text", "").startswith("\x89PNG")
                   for part in client.parts)


def test_prompt_accompanies_the_image_and_names_the_file(tmp_path):
    client = StubClient()
    path = write_image(tmp_path / "invoice_scan.png", "PNG")
    detector(client).detect(context_for(path, "image/png"))

    text = client.parts[1]["text"]
    assert text.startswith("You are a schema extraction engine, not a transcription engine.")
    assert "invoice_scan.png" in text
    assert "{{FILENAME}}" not in text and "{{MIME_TYPE}}" not in text


@pytest.mark.parametrize("fmt,mime", [("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp")])
def test_native_formats_keep_their_own_mime_type(tmp_path, fmt, mime):
    client = StubClient()
    path = write_image(tmp_path / f"sample.{fmt.lower()}", fmt)
    detector(client).detect(context_for(path, mime))
    assert client.parts[0]["inline_data"]["mime_type"] == mime


def test_mime_parameters_are_tolerated(tmp_path):
    client = StubClient()
    path = write_image(tmp_path / "sample.png", "PNG")
    detector(client).detect(context_for(path, "IMAGE/PNG; charset=binary"))
    assert client.parts[0]["inline_data"]["mime_type"] == "image/png"


# --------------------------------------------------------------- transcoding

@pytest.mark.parametrize("fmt,mime", [("BMP", "image/bmp"), ("TIFF", "image/tiff")])
def test_formats_gemini_rejects_are_re_encoded_to_png(tmp_path, fmt, mime):
    client = StubClient()
    path = write_image(tmp_path / f"scan.{fmt.lower()}", fmt)
    detector(client).detect(context_for(path, mime))

    inline = client.parts[0]["inline_data"]
    assert inline["mime_type"] == "image/png"
    sent = base64.b64decode(inline["data"])
    assert sent.startswith(b"\x89PNG")
    # Lossless: the pixels that carry the table survive the container change.
    assert Image.open(io.BytesIO(sent)).size == Image.open(path).size


def test_a_corrupt_image_is_a_domain_error(tmp_path):
    path = tmp_path / "broken.bmp"
    path.write_bytes(b"this is not a bitmap")
    with pytest.raises(InvalidInput) as exc:
        detector(StubClient()).detect(context_for(path, "image/bmp"))
    assert exc.value.code == "INVALID_INPUT"


# --------------------------------------------------------------------- limits

def test_an_oversized_image_is_refused(tmp_path):
    path = write_image(tmp_path / "big.png", "PNG", size=(400, 400))
    with pytest.raises(InvalidInput) as exc:
        detector(StubClient(), max_image_bytes=64).detect(context_for(path, "image/png"))
    assert exc.value.code == "GEMINI_FILE_TOO_LARGE"


def test_an_oversized_image_is_never_read_into_memory(tmp_path, monkeypatch):
    path = write_image(tmp_path / "big.png", "PNG", size=(400, 400))

    def explode(self, *args, **kwargs):
        raise AssertionError("the file was read before its size was checked")

    monkeypatch.setattr(Path, "read_bytes", explode)
    with pytest.raises(InvalidInput):
        detector(StubClient(), max_image_bytes=64).detect(context_for(path, "image/png"))


def test_an_unsupported_image_type_is_refused(tmp_path):
    path = write_image(tmp_path / "sample.png", "PNG")
    with pytest.raises(UnsupportedMimeType):
        detector(StubClient()).detect(context_for(path, "image/gif"))


# --------------------------------------------------------------------- result

def test_the_detector_returns_a_canonical_schema(tmp_path):
    path = write_image(tmp_path / "employees.png", "PNG")
    schema = detector(StubClient()).detect(context_for(path, "image/png"))
    assert set(schema.model_dump()) == {"name", "fields", "metadata"}
    assert schema.metadata["format"] == "image"
    assert schema.metadata["provider"] == "gemini"


def test_a_wrapped_response_is_flattened_by_the_detector(tmp_path):
    wrapped = json.dumps({"schema": json.loads(RESPONSE)})
    path = write_image(tmp_path / "employees.png", "PNG")
    schema = detector(StubClient(wrapped)).detect(context_for(path, "image/png"))
    assert schema.name == "employees"


def test_junk_from_the_model_never_becomes_a_schema(tmp_path):
    path = write_image(tmp_path / "employees.png", "PNG")
    with pytest.raises(InvalidInput) as exc:
        detector(StubClient("I think this might be a table?")).detect(context_for(path, "image/png"))
    assert exc.value.code == "GEMINI_JSON_INVALID"


# --------------------------------------------------------------- transport

def http_error(code: int, body: bytes = b'{"error":"nope"}'):
    return urllib.error.HTTPError("https://example.invalid", code, "boom", {}, io.BytesIO(body))


class FakeUrlopen:
    """Replays a scripted sequence of outcomes, one per request."""

    def __init__(self, *outcomes):
        self.outcomes, self.calls = list(outcomes), []

    def __call__(self, request, timeout=None):
        self.calls.append(request)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return io.BytesIO(json.dumps(outcome).encode())


def ok(text=RESPONSE):
    return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


def client(monkeypatch, *outcomes, max_retries=3):
    fake = FakeUrlopen(*outcomes)
    monkeypatch.setattr("urllib.request.urlopen", fake)
    gemini = GeminiClient("secret-key", "gemini-3.6-flash", max_retries=max_retries, sleep=lambda _: None)
    return gemini, fake


def test_a_busy_model_is_retried_until_it_answers(monkeypatch):
    gemini, fake = client(monkeypatch, http_error(503), http_error(429), ok())
    assert gemini.generate([{"text": "hi"}]) == RESPONSE
    assert len(fake.calls) == 3


def test_retries_are_bounded_and_end_as_transient(monkeypatch):
    gemini, fake = client(monkeypatch, *[http_error(503)] * 4, max_retries=3)
    with pytest.raises(TransientError) as exc:
        gemini.generate([{"text": "hi"}])
    assert exc.value.code == "GEMINI_UNAVAILABLE"
    assert len(fake.calls) == 4


def test_a_rejected_request_fails_immediately(monkeypatch):
    gemini, fake = client(monkeypatch, http_error(400), ok())
    with pytest.raises(InvalidInput) as exc:
        gemini.generate([{"text": "hi"}])
    assert exc.value.code == "GEMINI_REQUEST_FAILED"
    assert len(fake.calls) == 1


def test_a_bad_key_is_not_retried(monkeypatch):
    gemini, fake = client(monkeypatch, http_error(401), ok())
    with pytest.raises(InvalidInput):
        gemini.generate([{"text": "hi"}])
    assert len(fake.calls) == 1


def test_the_api_key_never_reaches_the_url(monkeypatch):
    gemini, fake = client(monkeypatch, ok())
    gemini.generate([{"text": "hi"}])
    request = fake.calls[0]
    assert "secret-key" not in request.full_url
    assert request.get_header("X-goog-api-key") == "secret-key"


def test_an_unreachable_endpoint_is_transient(monkeypatch):
    gemini, _ = client(monkeypatch, *[urllib.error.URLError("no route")] * 4)
    with pytest.raises(TransientError) as exc:
        gemini.generate([{"text": "hi"}])
    assert exc.value.code == "GEMINI_UNREACHABLE"


def test_reasoning_only_responses_are_an_error(monkeypatch):
    gemini, _ = client(monkeypatch, {"candidates": [{"content": {"parts": [{"thought": "hmm"}]}}]})
    with pytest.raises(InvalidInput) as exc:
        gemini.generate([{"text": "hi"}])
    assert exc.value.code == "GEMINI_EMPTY_RESPONSE"


def test_a_truncated_response_says_so_rather_than_looking_unparseable(monkeypatch):
    # Reported as an output-budget problem, not as the model returning junk.
    truncated = {"candidates": [{"finishReason": "MAX_TOKENS",
                                 "content": {"parts": [{"text": '{"name":"t","fields":[{"na'}]}}]}
    gemini, fake = client(monkeypatch, truncated)
    with pytest.raises(InvalidInput) as exc:
        gemini.generate([{"text": "hi"}])
    assert exc.value.code == "GEMINI_RESPONSE_TRUNCATED"
    assert len(fake.calls) == 1


def test_a_refused_response_is_not_retried(monkeypatch):
    refused = {"candidates": [{"finishReason": "SAFETY", "content": {"parts": [{"text": "{}"}]}}]}
    gemini, fake = client(monkeypatch, refused)
    with pytest.raises(InvalidInput) as exc:
        gemini.generate([{"text": "hi"}])
    assert exc.value.code == "GEMINI_REQUEST_REFUSED"
    assert len(fake.calls) == 1


def test_finish_reason_stop_is_accepted(monkeypatch):
    stopped = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": RESPONSE}]}}]}
    gemini, _ = client(monkeypatch, stopped)
    assert gemini.generate([{"text": "hi"}]) == RESPONSE


class NonJsonBody:
    """A 200 carrying an intermediary's HTML error page."""

    def __init__(self):
        self.calls = []

    def __call__(self, request, timeout=None):
        self.calls.append(request)
        return io.BytesIO(b"<html><body>502 from the proxy</body></html>")


def test_a_non_json_body_is_transient_not_an_internal_error(monkeypatch):
    # Letting the ValueError escape would settle the file as `internal`, which
    # is permanent, for something a retry would have fixed.
    fake = NonJsonBody()
    monkeypatch.setattr("urllib.request.urlopen", fake)
    gemini = GeminiClient("secret-key", max_retries=2, sleep=lambda _: None)
    with pytest.raises(TransientError):
        gemini.generate([{"text": "hi"}])
    assert len(fake.calls) == 3


def test_negative_max_retries_still_makes_one_request(monkeypatch):
    gemini, fake = client(monkeypatch, ok(), max_retries=-1)
    assert gemini.generate([{"text": "hi"}]) == RESPONSE
    assert len(fake.calls) == 1
