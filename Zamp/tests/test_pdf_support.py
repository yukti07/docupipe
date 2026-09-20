"""Reading records out of a PDF, without touching the network.

The mirror of `test_image_reader`, for the format that made the reader
necessary: a PDF is the one thing users drop that has neither a grid to parse
nor a single page to photograph, so both halves of the round trip go through
Gemini and neither half may be taken on trust.
"""
import base64
import json
from pathlib import Path

import pytest

from zamp_shared.domain import Schema, SourceFile
from zamp_shared.errors import InvalidInput, UnsupportedMimeType
from zamp_shared.failures import failure_class
from zamp_shared.llm import PromptRepository
from zamp_shared.mime import EXTENSION_TYPES

PROMPTS = Path(__file__).resolve().parents[1] / "python" / "prompts"

INVOICES = Schema(name="invoices", fields=[
    {"name": "invoice_number", "type": "text", "required": True},
    {"name": "issued_on", "type": "date", "required": True},
    {"name": "total", "type": "currency", "required": True, "currency": "USD",
     "aliases": ["amount_due"]},
])

ROWS = [
    {"invoice_number": "INV-1043", "issued_on": "2026-09-01", "total": 1420.5},
    {"invoice_number": "INV-1044", "issued_on": "2026-09-02", "total": 980.0},
]

RESPONSE = json.dumps({"records": ROWS})


class StubClient:
    def __init__(self, response=RESPONSE):
        self.response, self.parts = response, None

    def generate(self, parts):
        self.parts = parts
        return self.response


def write_pdf(path: Path, body: bytes = b"", header: bytes = b"%PDF-1.4\n") -> Path:
    """Enough of a PDF for the reader's own checks; Gemini is stubbed out."""
    path.write_bytes(header + body + b"\n%%EOF\n")
    return path


def source_for(path: Path, mime_type: str = "application/pdf") -> SourceFile:
    return SourceFile(id="file_1", request_id="request_1", user_id="user_1", bucket="b",
                      object_key=f"uploads/{path.name}", filename=path.name,
                      mime_type=mime_type, size_bytes=path.stat().st_size)


def reader(processor, client, max_pdf_bytes=14_000_000):
    return processor.GeminiPdfReader(client, PromptRepository(PROMPTS), max_pdf_bytes)


# ---------------------------------------------------------------- the request

def test_the_pdf_is_sent_whole_and_unaltered(processor, tmp_path):
    # Not transcoded and not rasterised: which value belongs to which column is
    # a fact about where things sit on the page, and the pages are already in
    # a format Gemini reads natively.
    client = StubClient()
    path = write_pdf(tmp_path / "invoices.pdf")
    list(reader(processor, client).read(source_for(path), str(path), INVOICES))

    inline = client.parts[0]["inline_data"]
    assert inline["mime_type"] == "application/pdf"
    assert base64.b64decode(inline["data"]) == path.read_bytes()


def test_the_approved_schema_and_filename_are_named_in_the_prompt(processor, tmp_path):
    client = StubClient()
    path = write_pdf(tmp_path / "invoices.pdf")
    list(reader(processor, client).read(source_for(path), str(path), INVOICES))

    text = client.parts[1]["text"]
    for name in ("invoice_number", "issued_on", "total"):
        assert f'"{name}"' in text
    assert "invoices.pdf" in text
    # An unsubstituted placeholder reaches the model as literal text and is the
    # kind of bug that only shows up as a worse answer.
    assert "{{SCHEMA}}" not in text and "{{FILENAME}}" not in text


def test_a_generic_upload_type_is_read_by_its_extension(processor, tmp_path):
    # The backend types an upload from its extension, but a row that arrived
    # some other way can carry the catch-all instead.
    client = StubClient()
    path = write_pdf(tmp_path / "invoices.pdf")
    list(reader(processor, client).read(
        source_for(path, "application/octet-stream"), str(path), INVOICES))
    assert client.parts[0]["inline_data"]["mime_type"] == "application/pdf"


def test_a_type_that_is_not_a_pdf_is_refused(processor, tmp_path):
    path = write_pdf(tmp_path / "invoices.pdf")
    with pytest.raises(UnsupportedMimeType):
        list(reader(processor, StubClient()).read(
            source_for(path, "image/gif"), str(path), INVOICES))


def test_a_charset_suffix_is_the_same_type(processor, tmp_path):
    client = StubClient()
    path = write_pdf(tmp_path / "invoices.pdf")
    list(reader(processor, client).read(
        source_for(path, "application/pdf; charset=binary"), str(path), INVOICES))
    assert client.parts[0]["inline_data"]["mime_type"] == "application/pdf"


def test_an_oversized_pdf_is_refused_before_the_request(processor, tmp_path):
    # Refused here rather than by Gemini: a 400 from the provider settles the
    # file as `provider_refused`, which sends the reader hunting for a prompt
    # bug instead of a file that was simply too big to send.
    client = StubClient()
    path = write_pdf(tmp_path / "big.pdf", b"x" * 4096)
    with pytest.raises(InvalidInput) as exc:
        list(reader(processor, client, max_pdf_bytes=64).read(
            source_for(path), str(path), INVOICES))
    assert exc.value.code == "GEMINI_FILE_TOO_LARGE"
    assert failure_class(exc.value.code) == "too_large"
    assert client.parts is None


def test_an_empty_file_is_not_sent(processor, tmp_path):
    path = tmp_path / "empty.pdf"
    path.write_bytes(b"")
    client = StubClient()
    with pytest.raises(InvalidInput) as exc:
        list(reader(processor, client).read(source_for(path), str(path), INVOICES))
    assert exc.value.code == "EMPTY_FILE"
    assert client.parts is None


def test_something_that_is_not_a_pdf_is_caught_before_the_request(processor, tmp_path):
    # A file named .pdf that holds a zip is the shortest route to a wasted
    # Gemini call, and the user is owed "we couldn't read it", not "the model
    # refused".
    path = tmp_path / "lying.pdf"
    path.write_bytes(b"PK\x03\x04" + bytes(2048))
    client = StubClient()
    with pytest.raises(InvalidInput) as exc:
        list(reader(processor, client).read(source_for(path), str(path), INVOICES))
    assert exc.value.code == "INVALID_PDF"
    assert failure_class(exc.value.code) == "format_corrupt"
    assert client.parts is None


def test_a_header_past_the_first_byte_is_still_a_pdf(processor, tmp_path):
    # Generators put junk before the header often enough that a strict
    # startswith would reject files every other reader opens.
    path = write_pdf(tmp_path / "offset.pdf", header=b"\n\n%PDF-1.7\n")
    client = StubClient()
    list(reader(processor, client).read(source_for(path), str(path), INVOICES))
    assert client.parts is not None


# ---------------------------------------------------------------- the records

def test_records_come_back_in_order_with_row_references(processor, tmp_path):
    path = write_pdf(tmp_path / "invoices.pdf")
    records = list(reader(processor, StubClient()).read(source_for(path), str(path), INVOICES))

    assert [r.values["invoice_number"] for r in records] == ["INV-1043", "INV-1044"]
    assert [r.source_reference.row_number for r in records] == [1, 2]


def test_records_survive_mapping_and_coercion(processor, tmp_path):
    path = write_pdf(tmp_path / "invoices.pdf")
    records = list(reader(processor, StubClient()).read(source_for(path), str(path), INVOICES))

    mapper, coercer = processor.SchemaMapper(), processor.TypeCoercer()
    mapped = mapper.map(records[0].values, INVOICES)
    converted = {f.name: coercer.coerce(mapped[f.name], f.type) for f in INVOICES.fields}
    assert converted["invoice_number"] == "INV-1043"
    assert float(converted["total"]) == 1420.5


def test_an_answer_under_an_alias_still_maps(processor, tmp_path):
    # The prompt shows the model the aliases, so it may answer under one. The
    # mapper resolves them — this is the test that says so on purpose rather
    # than by luck.
    aliased = json.dumps({"records": [
        {"invoice_number": "INV-1043", "issued_on": "2026-09-01", "amount_due": 1420.5}]})
    path = write_pdf(tmp_path / "invoices.pdf")
    records = list(reader(processor, StubClient(aliased)).read(source_for(path), str(path), INVOICES))
    assert processor.SchemaMapper().map(records[0].values, INVOICES)["total"] == 1420.5


def test_a_pdf_that_yielded_nothing_is_a_failure_not_an_empty_table(processor, tmp_path):
    # A schema was detected from this document, so something table-shaped was
    # there. Zero rows means the read failed.
    path = write_pdf(tmp_path / "invoices.pdf")
    with pytest.raises(InvalidInput) as exc:
        list(reader(processor, StubClient(json.dumps({"records": []}))).read(
            source_for(path), str(path), INVOICES))
    assert exc.value.code == "EXTRACT_EMPTY"


# ---------------------------------------------------------------- the routing

def test_the_registry_resolves_a_pdf_by_type_and_by_extension(processor, tmp_path):
    pdf = reader(processor, StubClient())
    registry = processor.ProcessorRegistry({"application/pdf": pdf})
    assert registry.resolve("application/pdf", "invoices.pdf") is pdf
    assert registry.resolve("application/pdf; charset=binary", "invoices.pdf") is pdf
    # The extension table is what saves a row whose type never survived upload.
    assert EXTENSION_TYPES[".pdf"] == "application/pdf"
    assert registry.resolve("application/octet-stream", "invoices.pdf") is pdf
    assert registry.resolve("", "invoices.pdf") is pdf


def test_the_detector_and_the_processor_agree_that_a_pdf_is_a_pdf():
    # Two copies of this table drift; the failure is quiet and confusing —
    # the detector reads the file and moves it to SCHEMA_READY, then Convert
    # refuses it as UNSUPPORTED_MIME_TYPE.
    from app.detectors.gemini import NATIVE_MIME_TYPES
    assert EXTENSION_TYPES[".pdf"] in NATIVE_MIME_TYPES
