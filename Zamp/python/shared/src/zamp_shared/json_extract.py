"""Finding JSON inside whatever a model actually sent back.

Both workers ask Gemini for JSON and both get prose, fences and stray objects
around it. The rules for digging the JSON out are identical; only what counts as
a plausible answer differs, so that part stays with each caller.
"""

from __future__ import annotations

import json
from typing import Any

#: One extra decode, for a response that is a JSON string holding JSON. Going
#: deeper would follow the model wherever it wanted to lead.
MAX_STRING_DECODES = 1


def strip_fences(text: str) -> str:
    """Remove a surrounding markdown code fence, if there is one.

    Tolerates a missing language tag and a missing closing fence, both of which
    happen when the response is truncated.
    """
    if not text.startswith("```"):
        return text
    newline = text.find("\n")
    body = text[newline + 1:] if newline != -1 else text[3:]
    closing = body.rfind("```")
    return (body[:closing] if closing != -1 else body).strip()


def loads(text: str) -> Any:
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None


def parse_direct(text: str) -> Any:
    """The whole response as one value, unwrapping a single layer of stringified JSON."""
    value = loads(text)
    for _ in range(MAX_STRING_DECODES):
        if not isinstance(value, str):
            break
        value = loads(strip_fences(value.strip()))
    return value


def scan(text: str, openers: str = "{") -> list[Any]:
    """Every decodable JSON value in the text, in the order they start.

    A regex cannot do this. `{.*}` runs from the first brace to the last one
    across unrelated objects, and the non-greedy form stops inside the first
    nested one. `raw_decode` is the only thing that knows where a value ends.
    """
    decoder = json.JSONDecoder()
    found: list[Any] = []
    for index, character in enumerate(text):
        if character not in openers:
            continue
        try:
            value, _ = decoder.raw_decode(text[index:])
        except (json.JSONDecodeError, ValueError):
            continue
        found.append(value)
    return found
