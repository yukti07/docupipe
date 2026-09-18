"""Reading records out of an image, without touching the network."""
import base64
import json
from pathlib import Path

import pytest
from PIL import Image

from zamp_shared.domain import Schema, SourceFile
from zamp_shared.errors import InvalidInput, UnsupportedMimeType
from zamp_shared.llm import PromptRepository

PROMPTS = Path(__file__).resolve().parents[1] / "python" / "prompts"

EMPLOYEES = Schema(name="employees", fields=[
    {"name": "employee_id", "type": "text", "required": True},
    {"name": "first_name", "type": "text", "required": True},
    {"name": "last_name", "type": "text", "required": True},
    {"name": "department", "type": "text", "required": True},
    {"name": "salary", "type": "number", "required": True},
])

ROWS = [
    {"employee_id": "1001", "first_name": "Aarav", "last_name": "Sharma", "department": "Sales", "salary": 72000},
    {"employee_id": "1002", "first_name": "Diya", "last_name": "Mehta", "department": "Marketing", "salary": 68000},
]

RESPONSE = json.dumps({"records": ROWS})


class StubClient:
    def __init__(self, response=RESPONSE):
        self.response, self.parts = response, None

    def generate(self, parts):
        self.parts = parts
        return self.response


def write_image(path: Path, fmt: str = "PNG", size=(40, 20)) -> Path:
    Image.new("RGB", size, (250, 250, 250)).save(path, format=fmt)
    return path


def source_for(path: Path, mime_type: str = "image/png") -> SourceFile:
    return SourceFile(id="file_1", request_id="request_1", user_id="user_1", bucket="b",
                      object_key=f"uploads/{path.name}", filename=path.name,
                      mime_type=mime_type, size_bytes=path.stat().st_size)


def reader(processor, client, max_image_bytes=14_000_000):
    return processor.GeminiImageReader(client, PromptRepository(PROMPTS), max_image_bytes)


# ---------------------------------------------------------------- the request

def test_the_image_is_sent_as_pixels(processor, tmp_path):
    client = StubClient()
    path = write_image(tmp_path / "employees.png")
    list(reader(processor, client).read(source_for(path), str(path), EMPLOYEES))

    inline = client.parts[0]["inline_data"]
    assert inline["mime_type"] == "image/png"
    assert base64.b64decode(inline["data"]) == path.read_bytes()


def test_the_approved_schema_is_named_in_the_prompt(processor, tmp_path):
    client = StubClient()
    path = write_image(tmp_path / "employees.png")
    list(reader(processor, client).read(source_for(path), str(path), EMPLOYEES))

    text = client.parts[1]["text"]
    for name in ("employee_id", "first_name", "last_name", "department", "salary"):
        assert f'"{name}"' in text
    assert "employees.png" in text
    assert "{{SCHEMA}}" not in text and "{{FILENAME}}" not in text


def test_aliases_are_not_offered_to_the_model(processor, tmp_path):
    # The mapper looks up by field name first; showing the model an alias invites
    # it to answer under a key the record then gets mapped from twice over.
    schema = Schema(name="t", fields=[{"name": "amount", "type": "currency", "aliases": ["total"]}])
    client = StubClient(json.dumps({"records": [{"amount": 1}]}))
    path = write_image(tmp_path / "t.png")
    list(reader(processor, client).read(source_for(path), str(path), schema))
    text = client.parts[1]["text"]
    assert '"amount"' in text
    assert '"aliases"' not in text and '"total"' not in text


def test_bmp_is_transcoded_for_the_reader_too(processor, tmp_path):
    client = StubClient()
    path = write_image(tmp_path / "scan.bmp", "BMP")
    list(reader(processor, client).read(source_for(path, "image/bmp"), str(path), EMPLOYEES))
    assert client.parts[0]["inline_data"]["mime_type"] == "image/png"


def test_an_unsupported_type_is_refused(processor, tmp_path):
    path = write_image(tmp_path / "t.png")
    with pytest.raises(UnsupportedMimeType):
        list(reader(processor, StubClient()).read(source_for(path, "image/gif"), str(path), EMPLOYEES))


def test_an_oversized_image_is_refused(processor, tmp_path):
    path = write_image(tmp_path / "big.png", size=(400, 400))
    with pytest.raises(InvalidInput) as exc:
        list(reader(processor, StubClient(), max_image_bytes=64).read(source_for(path), str(path), EMPLOYEES))
    assert exc.value.code == "GEMINI_FILE_TOO_LARGE"


# ---------------------------------------------------------------- the records

def test_records_come_back_in_order_with_row_references(processor, tmp_path):
    path = write_image(tmp_path / "employees.png")
    records = list(reader(processor, StubClient()).read(source_for(path), str(path), EMPLOYEES))

    assert [r.values["employee_id"] for r in records] == ["1001", "1002"]
    assert [r.source_reference.row_number for r in records] == [1, 2]


def test_records_survive_mapping_and_coercion(processor, tmp_path):
    path = write_image(tmp_path / "employees.png")
    records = list(reader(processor, StubClient()).read(source_for(path), str(path), EMPLOYEES))

    mapper, coercer = processor.SchemaMapper(), processor.TypeCoercer()
    mapped = mapper.map(records[0].values, EMPLOYEES)
    converted = {f.name: coercer.coerce(mapped[f.name], f.type) for f in EMPLOYEES.fields}
    assert converted == {"employee_id": "1001", "first_name": "Aarav", "last_name": "Sharma",
                         "department": "Sales", "salary": 72000.0}


# ----------------------------------------------------------------- the parser

def test_parser_accepts_a_bare_array(processor):
    assert processor.parse_records(json.dumps(ROWS), EMPLOYEES) == ROWS


def test_parser_accepts_a_fenced_wrapper(processor):
    assert processor.parse_records("```json\n" + RESPONSE + "\n```", EMPLOYEES) == ROWS


def test_parser_accepts_prose_around_the_records(processor):
    raw = "I found two employees:\n" + RESPONSE + "\nHope that helps."
    assert processor.parse_records(raw, EMPLOYEES) == ROWS


@pytest.mark.parametrize("key", ["records", "rows", "data", "items", "results"])
def test_parser_accepts_the_usual_wrapper_keys(processor, key):
    assert processor.parse_records(json.dumps({key: ROWS}), EMPLOYEES) == ROWS


def test_parser_accepts_a_json_string_containing_json(processor):
    assert processor.parse_records(json.dumps(RESPONSE), EMPLOYEES) == ROWS


def test_parser_rejects_prose_only(processor):
    with pytest.raises(InvalidInput) as exc:
        processor.parse_records("I could not read this table.", EMPLOYEES)
    assert exc.value.code == "GEMINI_JSON_INVALID"


def test_parser_rejects_malformed_json(processor):
    with pytest.raises(InvalidInput) as exc:
        processor.parse_records('{"records": [', EMPLOYEES)
    assert exc.value.code == "GEMINI_JSON_INVALID"


def test_parser_rejects_non_object_records(processor):
    with pytest.raises(InvalidInput) as exc:
        processor.parse_records(json.dumps({"records": [["1001", "Aarav"]]}), EMPLOYEES)
    assert exc.value.code in {"GEMINI_RECORDS_INVALID", "GEMINI_JSON_INVALID"}


def test_parser_rejects_an_empty_result(processor):
    # A schema was detected from this image, so zero rows means the read failed.
    with pytest.raises(InvalidInput) as exc:
        processor.parse_records(json.dumps({"records": []}), EMPLOYEES)
    assert exc.value.code == "EXTRACT_EMPTY"


def test_parser_rejects_an_empty_response(processor):
    with pytest.raises(InvalidInput) as exc:
        processor.parse_records("   ", EMPLOYEES)
    assert exc.value.code == "GEMINI_EMPTY_RESPONSE"


def test_missing_values_stay_null_rather_than_disappearing(processor, tmp_path):
    sparse = json.dumps({"records": [{"employee_id": "1001", "first_name": "Aarav", "last_name": None,
                                      "department": "Sales", "salary": None}]})
    path = write_image(tmp_path / "employees.png")
    records = list(reader(processor, StubClient(sparse)).read(source_for(path), str(path), EMPLOYEES))
    assert records[0].values["salary"] is None
