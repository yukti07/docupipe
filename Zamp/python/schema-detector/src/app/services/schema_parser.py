"""Turning an untrusted model response into a canonical `Schema`.

Everything Gemini returns is external data. It arrives wrapped in fences, buried
in prose, doubled up, re-encoded as a string, or shaped like something adjacent
to the contract but not the contract. The detectors are not the place to learn
all of that, so the whole journey from text to validated `Schema` lives here:

    raw text -> extract -> normalize -> Schema.model_validate -> semantics

Normalization deliberately runs *before* Pydantic. `Schema.unique_names` rejects
duplicate field names outright, and duplicates are the one case where the right
answer depends on whether the two objects actually say the same thing — which
can only be judged on the raw dicts.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from pydantic import ValidationError
from zamp_shared.domain import Schema, SchemaField
from zamp_shared.errors import InvalidInput
from zamp_shared.json_extract import parse_direct, scan, strip_fences

log = logging.getLogger(__name__)

ROOT_KEYS = frozenset({"name", "fields", "metadata"})
FIELD_KEYS = frozenset({"name", "type", "required", "description", "aliases", "fields", "item_type", "item_fields"})
LIST_TYPES = frozenset({"array", "list"})

#: `fields` is the load-bearing key; `name` without it describes nothing. A
#: candidate missing either is not a schema no matter what else it carries.
REQUIRED_CANDIDATE_KEYS = ("name", "fields")


def parse_schema(raw: str, *, format_override: str | None = None) -> Schema:
    """The only supported way to turn a Gemini response into a `Schema`."""
    payload = extract_payload(raw)
    normalized = normalize(payload, format_override=format_override)
    try:
        schema = Schema.model_validate(normalized)
    except ValidationError as exc:
        log.warning("gemini schema failed validation", extra={"stage": "pydantic", "detail": str(exc)[:512]})
        raise InvalidInput("Gemini returned an invalid schema", "GEMINI_SCHEMA_INVALID") from exc
    validate_semantics(schema)
    return schema


# ------------------------------------------------------------------ extraction

def extract_payload(raw: str) -> dict[str, Any]:
    """Find the one object in `raw` that is trying to be a schema."""
    if not isinstance(raw, str) or not raw.strip():
        raise InvalidInput("Gemini returned no text", "GEMINI_EMPTY_RESPONSE")

    cleaned = strip_fences(raw.strip())

    candidates: list[dict[str, Any]] = []
    direct = parse_direct(cleaned)
    if isinstance(direct, dict):
        candidates.append(direct)
    else:
        candidates.extend(value for value in scan(cleaned) if isinstance(value, dict))

    best = _choose(candidates)
    if best is None:
        log.warning("no schema object in gemini response", extra={"stage": "extract", "response_length": len(raw)})
        raise InvalidInput("Gemini response did not contain the required JSON envelope", "GEMINI_JSON_INVALID")
    return best


def _choose(candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The candidate closest to the contract, unwrapped if it is wrapped.

    A `{"schema": {...}, "metadata": {...}}` response is accepted and flattened
    here, and only here. Nothing downstream is allowed to learn that the wrapper
    exists.
    """
    best: dict[str, Any] | None = None
    best_score = 0
    for candidate in candidates:
        for unwrapped in _unwrap(candidate):
            score = _score(unwrapped)
            if score > best_score:
                best, best_score = unwrapped, score
    return best


def _unwrap(candidate: dict[str, Any]) -> list[dict[str, Any]]:
    """The candidate itself, plus its unwrapped form if it wraps a schema."""
    forms = [candidate]
    inner = candidate.get("schema")
    if isinstance(inner, dict) and all(key in inner for key in REQUIRED_CANDIDATE_KEYS):
        flattened = dict(inner)
        # A sibling `metadata` belongs to the schema the wrapper was hiding.
        if "metadata" not in flattened and isinstance(candidate.get("metadata"), dict):
            flattened["metadata"] = candidate["metadata"]
        forms.append(flattened)
    return forms


def _score(candidate: dict[str, Any]) -> int:
    if not all(key in candidate for key in REQUIRED_CANDIDATE_KEYS):
        return 0
    return 2 + (1 if isinstance(candidate.get("metadata"), dict) else 0)


# --------------------------------------------------------------- normalization

def normalize(payload: dict[str, Any], *, format_override: str | None = None) -> dict[str, Any]:
    """Meaning-preserving repairs only.

    Anything that would change what the schema says — merging fields that differ,
    inventing a type — is left for validation to reject instead.
    """
    notes: list[str] = []
    normalized = {key: value for key, value in payload.items() if key in ROOT_KEYS}
    fields = normalized.get("fields")
    normalized["fields"] = _normalize_fields(fields, notes) if isinstance(fields, list) else fields
    normalized["metadata"] = _normalize_metadata(payload.get("metadata"), format_override, notes)
    return normalized


def _normalize_fields(fields: list[Any], notes: list[str]) -> list[Any]:
    return _deduplicate([_normalize_field(field, notes) for field in fields])


def _normalize_field(field: Any, notes: list[str]) -> Any:
    if not isinstance(field, dict):
        return field  # Pydantic says what is wrong with it far better than we can.
    normalized = {key: value for key, value in field.items() if key in FIELD_KEYS}

    required = normalized.get("required", False)
    if not isinstance(required, bool):
        # Pydantic would quietly turn the string "true" into True. A model that
        # cannot emit a JSON boolean has not understood the contract, and
        # guessing on its behalf is how a field silently becomes mandatory.
        raise InvalidInput("Gemini returned a non-boolean required flag", "GEMINI_SCHEMA_INVALID")
    normalized["required"] = required

    for key in ("aliases", "fields", "item_fields"):
        if normalized.get(key) is None:
            normalized[key] = []
    normalized.setdefault("item_type", None)

    for key in ("fields", "item_fields"):
        if isinstance(normalized[key], list):
            normalized[key] = _normalize_fields(normalized[key], notes)
    return normalized


def _deduplicate(fields: list[Any]) -> list[Any]:
    """Drop repeats only when they are the same field twice.

    Two entries called `date` that disagree are two different claims about the
    document. Merging them picks one at random and calls it the answer.
    """
    seen: dict[str, str] = {}
    result: list[Any] = []
    for field in fields:
        if not isinstance(field, dict) or not isinstance(field.get("name"), str):
            result.append(field)
            continue
        key = field["name"].casefold()
        fingerprint = json.dumps(field, sort_keys=True, default=str)
        if key not in seen:
            seen[key] = fingerprint
            result.append(field)
        elif seen[key] != fingerprint:
            raise InvalidInput(f"Gemini returned conflicting definitions for field {field['name']!r}",
                               "GEMINI_SCHEMA_INVALID")
    return result


def _normalize_metadata(value: Any, format_override: str | None, notes: list[str]) -> dict[str, Any]:
    metadata = dict(value) if isinstance(value, dict) else {}

    if "confidence" in metadata:
        confidence = _as_float(metadata["confidence"])
        if confidence is None:
            metadata.pop("confidence")
            notes.append("model-reported confidence was not numeric and was dropped")
        else:
            # Clamped, not rescaled: a model answering 95 means 0.95, but it
            # also might mean nothing at all. Confidence here is what the model
            # said about itself, never a calibrated probability.
            metadata["confidence"] = min(1.0, max(0.0, confidence))

    existing = metadata.get("notes")
    metadata["notes"] = ([str(note) for note in existing] if isinstance(existing, list) else []) + notes
    metadata["provider"] = "gemini"
    if format_override:
        metadata["format"] = format_override
    return metadata


def _as_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


# ---------------------------------------------------------- semantic validation

def validate_semantics(schema: Schema) -> None:
    """The rules the domain model does not already carry.

    `Schema` enforces its invariants at the root and stops there, so a nested
    `item_fields` list with two `amount` entries validates cleanly today.
    """
    if not schema.name.strip():
        raise InvalidInput("Gemini returned a schema with a blank name", "GEMINI_SCHEMA_INVALID")
    _validate_level(schema.fields, "")


def _validate_level(fields: list[SchemaField], path: str) -> None:
    seen: set[str] = set()
    for field in fields:
        location = f"{path}.{field.name}" if path else field.name
        if not field.name.strip():
            raise InvalidInput(f"Gemini returned a blank field name under {path or 'the schema root'}",
                               "GEMINI_SCHEMA_INVALID")
        key = field.name.casefold()
        if key in seen:
            raise InvalidInput(f"Gemini returned duplicate field {field.name!r} under {path or 'the schema root'}",
                               "GEMINI_SCHEMA_INVALID")
        seen.add(key)

        if field.type not in LIST_TYPES and (field.item_type or field.item_fields):
            raise InvalidInput(f"Field {location!r} is {field.type} but describes list items",
                               "GEMINI_SCHEMA_INVALID")

        _validate_level(field.fields, location)
        _validate_level(field.item_fields, location)
