"""The parser is the only thing standing between the model and the database.

Every case here is something Gemini has a real chance of doing. None of them
reach the network.
"""
import json
from pathlib import Path

import pytest

from zamp_shared.errors import InvalidInput
from app.services.schema_parser import extract_payload, parse_schema

FIXTURES = Path(__file__).parent / "fixtures" / "gemini"


def field(name="id", type_="integer", **overrides):
    base = {"name": name, "type": type_, "required": False, "description": None,
            "aliases": [], "fields": [], "item_type": None, "item_fields": []}
    base.update(overrides)
    return base


def payload(fields=None, name="records", metadata=None):
    return {"name": name, "fields": fields if fields is not None else [field()],
            "metadata": metadata if metadata is not None else {"format": "image", "confidence": 0.9,
                                                               "notes": [], "provider": "gemini"}}


# ------------------------------------------------------------------ extraction

def test_1_clean_json():
    schema = parse_schema(json.dumps(payload()))
    assert schema.name == "records"
    assert [f.name for f in schema.fields] == ["id"]


def test_2_fenced_json():
    schema = parse_schema("```json\n" + json.dumps(payload()) + "\n```")
    assert schema.fields[0].name == "id"


def test_2b_fence_without_language_tag_or_closing_fence():
    assert parse_schema("```\n" + json.dumps(payload())).fields[0].name == "id"


def test_3_json_preceded_by_prose():
    schema = parse_schema("Here is the schema:\n\n" + json.dumps(payload()))
    assert schema.fields[0].name == "id"


def test_4_json_followed_by_prose():
    schema = parse_schema(json.dumps(payload()) + "\n\nLet me know if you need anything else.")
    assert schema.fields[0].name == "id"


def test_5_multiple_objects_picks_the_schema():
    noise = json.dumps({"note": "thinking out loud"})
    raw = noise + "\n" + json.dumps(payload(name="the_real_one"))
    assert parse_schema(raw).name == "the_real_one"


def test_5b_prefers_the_candidate_carrying_metadata():
    without = json.dumps({"name": "bare", "fields": [field()]})
    with_metadata = json.dumps(payload(name="complete"))
    assert parse_schema(without + "\n" + with_metadata).name == "complete"


def test_6_schema_wrapper_is_flattened():
    inner = payload(name="wrapped")
    raw = json.dumps({"schema": {"name": inner["name"], "fields": inner["fields"]},
                      "metadata": inner["metadata"]})
    schema = parse_schema(raw)
    assert schema.name == "wrapped"
    assert schema.metadata["format"] == "image"


def test_6b_wrapper_never_survives_into_the_canonical_object():
    raw = json.dumps({"schema": payload(name="wrapped")})
    dumped = parse_schema(raw).model_dump()
    assert set(dumped) == {"name", "fields", "metadata"}


def test_7_json_string_containing_json():
    assert parse_schema(json.dumps(json.dumps(payload(name="doubly")))).name == "doubly"


def test_7b_second_decode_is_not_recursive():
    triple = json.dumps(json.dumps(json.dumps(payload())))
    with pytest.raises(InvalidInput) as exc:
        parse_schema(triple)
    assert exc.value.code == "GEMINI_JSON_INVALID"


def test_8_malformed_json_is_rejected():
    with pytest.raises(InvalidInput) as exc:
        parse_schema('{"name": "records", "fields": [')
    assert exc.value.code == "GEMINI_JSON_INVALID"


def test_8b_no_json_at_all():
    with pytest.raises(InvalidInput) as exc:
        parse_schema("I was unable to read this image.")
    assert exc.value.code == "GEMINI_JSON_INVALID"


def test_8c_empty_response():
    with pytest.raises(InvalidInput) as exc:
        parse_schema("   ")
    assert exc.value.code == "GEMINI_EMPTY_RESPONSE"


def test_nested_object_inside_prose_is_not_mistaken_for_the_schema():
    # A naive `\\{.*\\}` regex spans both objects and decodes neither.
    raw = 'thinking: {"inner": {"deep": 1}} then the answer ' + json.dumps(payload(name="answer"))
    assert parse_schema(raw).name == "answer"


# ------------------------------------------------------------------ validation

def test_9_valid_json_but_not_a_schema():
    with pytest.raises(InvalidInput) as exc:
        parse_schema(json.dumps({"name": "records", "fields": "not-a-list", "metadata": {}}))
    assert exc.value.code == "GEMINI_SCHEMA_INVALID"


def test_10_identical_duplicates_collapse():
    duplicate = field("date", "date")
    schema = parse_schema(json.dumps(payload(fields=[duplicate, dict(duplicate)])))
    assert [f.name for f in schema.fields] == ["date"]


def test_10b_conflicting_duplicates_are_rejected():
    with pytest.raises(InvalidInput) as exc:
        parse_schema(json.dumps(payload(fields=[field("date", "date"),
                                                field("date", "text", description="something else")])))
    assert exc.value.code == "GEMINI_SCHEMA_INVALID"


def test_10c_duplicates_nested_in_item_fields_are_rejected():
    items = field("items", "array", item_type="object",
                  item_fields=[field("amount", "currency"), field("amount", "text")])
    with pytest.raises(InvalidInput) as exc:
        parse_schema(json.dumps(payload(fields=[items])))
    assert exc.value.code == "GEMINI_SCHEMA_INVALID"


def test_11_unsupported_field_type():
    with pytest.raises(InvalidInput) as exc:
        parse_schema(json.dumps(payload(fields=[field("price", "money")])))
    assert exc.value.code == "GEMINI_SCHEMA_INVALID"


def test_12_missing_name():
    with pytest.raises(InvalidInput) as exc:
        parse_schema(json.dumps({"fields": [field()], "metadata": {}}))
    assert exc.value.code == "GEMINI_JSON_INVALID"


def test_12b_blank_name():
    with pytest.raises(InvalidInput) as exc:
        parse_schema(json.dumps(payload(name="   ")))
    assert exc.value.code == "GEMINI_SCHEMA_INVALID"


def test_13_missing_fields():
    with pytest.raises(InvalidInput) as exc:
        parse_schema(json.dumps({"name": "records", "metadata": {}}))
    assert exc.value.code == "GEMINI_JSON_INVALID"


def test_13b_empty_fields_list():
    with pytest.raises(InvalidInput) as exc:
        parse_schema(json.dumps(payload(fields=[])))
    assert exc.value.code == "GEMINI_SCHEMA_INVALID"


def test_14_invalid_metadata_is_replaced_not_fatal():
    schema = parse_schema(json.dumps(payload(metadata="confident")))
    assert schema.metadata["provider"] == "gemini"
    assert schema.metadata["notes"] == []


def test_14b_confidence_is_clamped():
    assert parse_schema(json.dumps(payload(metadata={"confidence": 7.5}))).metadata["confidence"] == 1.0
    assert parse_schema(json.dumps(payload(metadata={"confidence": -2}))).metadata["confidence"] == 0.0


def test_14c_numeric_string_confidence_is_coerced():
    assert parse_schema(json.dumps(payload(metadata={"confidence": "0.42"}))).metadata["confidence"] == 0.42


def test_14d_unusable_confidence_is_dropped_with_a_note():
    metadata = parse_schema(json.dumps(payload(metadata={"confidence": "high"}))).metadata
    assert "confidence" not in metadata
    assert any("confidence" in note for note in metadata["notes"])


def test_14e_provider_and_format_are_forced():
    schema = parse_schema(json.dumps(payload(metadata={"provider": "openai", "format": "pdf"})),
                          format_override="image")
    assert schema.metadata["provider"] == "gemini"
    assert schema.metadata["format"] == "image"


def test_15_nested_item_fields_round_trip():
    items = field("items", "array", item_type="object", item_fields=[
        field("description", "text"), field("quantity", "integer")])
    schema = parse_schema(json.dumps(payload(fields=[items])))
    assert [f.name for f in schema.fields[0].item_fields] == ["description", "quantity"]


def test_15b_item_metadata_on_a_scalar_field_is_rejected():
    with pytest.raises(InvalidInput) as exc:
        parse_schema(json.dumps(payload(fields=[field("total", "currency", item_type="object")])))
    assert exc.value.code == "GEMINI_SCHEMA_INVALID"


def test_16_content_fallback():
    content = field("content", "text", description="Full text content of the image")
    schema = parse_schema(json.dumps(payload(fields=[content], name="notice")))
    assert [f.name for f in schema.fields] == ["content"]
    assert schema.fields[0].type == "text"


def test_non_boolean_required_is_rejected_rather_than_coerced():
    with pytest.raises(InvalidInput) as exc:
        parse_schema(json.dumps(payload(fields=[field("id", "integer", required="true")])))
    assert exc.value.code == "GEMINI_SCHEMA_INVALID"


def test_unknown_keys_are_dropped():
    noisy = field("id", "integer")
    noisy["confidence"] = 0.4
    schema = parse_schema(json.dumps({**payload(fields=[noisy]), "explanation": "because"}))
    assert set(schema.model_dump()) == {"name", "fields", "metadata"}


def test_missing_optional_keys_are_filled():
    schema = parse_schema(json.dumps(payload(fields=[{"name": "id", "type": "integer"}])))
    assert schema.fields[0].aliases == [] and schema.fields[0].item_type is None


def test_null_aliases_become_empty():
    schema = parse_schema(json.dumps(payload(fields=[field("id", "integer", aliases=None)])))
    assert schema.fields[0].aliases == []


# -------------------------------------------------------------------- fixtures

@pytest.mark.parametrize("name", ["invoice", "receipt", "spreadsheet_screenshot",
                                  "form", "prose_fallback", "mixed_invoice"])
def test_realistic_fixture_responses_parse(name):
    schema = parse_schema((FIXTURES / f"{name}.txt").read_text(encoding="utf-8"), format_override="image")
    assert schema.fields
    assert schema.metadata["provider"] == "gemini"
    assert schema.metadata["format"] == "image"


def test_invoice_fixture_keeps_its_nested_line_items():
    schema = parse_schema((FIXTURES / "invoice.txt").read_text(encoding="utf-8"))
    items = next(f for f in schema.fields if f.name == "items")
    assert items.type == "array" and items.item_type == "object"
    assert [f.name for f in items.item_fields] == ["item", "quantity", "unit_price", "total"]


def test_spreadsheet_fixture_has_one_field_per_column_not_per_row():
    schema = parse_schema((FIXTURES / "spreadsheet_screenshot.txt").read_text(encoding="utf-8"))
    assert [f.name for f in schema.fields] == ["employee_id", "first_name", "last_name", "department", "salary"]


def test_prose_fixture_is_the_content_fallback():
    schema = parse_schema((FIXTURES / "prose_fallback.txt").read_text(encoding="utf-8"))
    assert [f.name for f in schema.fields] == ["content"]


def test_form_fixture_arrives_unwrapped():
    raw = (FIXTURES / "form.txt").read_text(encoding="utf-8")
    assert '"schema"' in raw
    assert "schema" not in extract_payload(raw)
