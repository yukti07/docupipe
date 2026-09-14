"""Field shapes, and the hash that makes apply-to-all one index lookup.

The hash is computed over `original_fields` — the shape as first detected,
never the edited one. That is what makes the apply-to-all rule statable in a
sentence ("this reaches the files that started out looking like this one") and
therefore predictable. Hashing the current shape instead would make the
affected set depend on the order the user made their edits in.

It is order-independent, because field order is not part of what makes two
tables the same shape. It is also what the merge compatibility check compares.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Iterable

FIELD_TYPES = ("text", "number", "date", "currency", "boolean", "list")

ORIGIN_DETECTED = "detected"
# The frontend renders the "added by you" marker on `origin === "added"`
# (SchemaFieldRow.tsx). Anything else silently never shows it.
ORIGIN_ADDED = "added"


def make_field(
    key: str,
    *,
    label: str | None = None,
    type_: str = "text",
    required: bool = False,
    origin: str = ORIGIN_DETECTED,
) -> dict[str, Any]:
    if type_ not in FIELD_TYPES:
        raise ValueError(f"unknown field type {type_!r}; expected one of {FIELD_TYPES}")
    return {
        "key": key,
        "label": label if label is not None else key,
        "type": type_,
        "required": required,
        "origin": origin,
    }


def normalise(fields: Iterable[dict[str, Any]]) -> list[tuple[str, str]]:
    """Reduce a field list to the pairs that decide identity.

    Only name and type. Labels, required flags and origin are not part of
    whether two tables share a shape — the merge check is
    same-names-same-types, order-independent, and this is that rule expressed
    once so the hash and the check cannot disagree.
    """
    pairs = [(str(f["key"]).strip().lower(), str(f["type"]).strip().lower()) for f in fields]
    return sorted(pairs)


def shape_hash(fields: Iterable[dict[str, Any]]) -> str:
    canonical = json.dumps(normalise(fields), separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def same_shape(a: Iterable[dict[str, Any]], b: Iterable[dict[str, Any]]) -> bool:
    return normalise(a) == normalise(b)
