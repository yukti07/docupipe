from __future__ import annotations

import math
import re
from datetime import date, datetime
from typing import Any

from zamp_shared.errors import InvalidInput


class TypeCoercer:
    def coerce(self, value: Any, target_type: str) -> Any:
        if value is None or (isinstance(value, float) and math.isnan(value)): return None
        if target_type in {"string", "text"}: return str(value)
        if target_type == "integer":
            if isinstance(value, bool): raise InvalidInput("Boolean cannot be coerced to integer", "TYPE_COERCION_FAILED")
            number = float(value)
            if not number.is_integer(): raise InvalidInput(f"{value!r} is not an integer", "TYPE_COERCION_FAILED")
            return int(number)
        if target_type == "currency": return _amount(value)
        if target_type == "number": return float(str(value).replace(",", "").replace("$", "").replace("₹", ""))
        if target_type == "boolean":
            if isinstance(value, bool): return value
            normalized = str(value).strip().casefold()
            if normalized in {"true", "1", "yes", "y"}: return True
            if normalized in {"false", "0", "no", "n"}: return False
            raise InvalidInput(f"{value!r} is not a boolean", "TYPE_COERCION_FAILED")
        if target_type == "date":
            if isinstance(value, datetime): return value.date()
            if isinstance(value, date): return value
            return date.fromisoformat(str(value))
        if target_type == "datetime":
            if isinstance(value, datetime): return value
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if target_type in {"array", "list"}:
            if not isinstance(value, list): raise InvalidInput("Value is not an array", "TYPE_COERCION_FAILED")
            return value
        if target_type == "object":
            if not isinstance(value, dict): raise InvalidInput("Value is not an object", "TYPE_COERCION_FAILED")
            return value
        if target_type == "null":
            if value is not None: raise InvalidInput("Value must be null", "TYPE_COERCION_FAILED")
            return None
        raise InvalidInput(f"Unsupported target type {target_type}", "INVALID_SCHEMA")


#: Currency symbols and ISO codes stripped before an amount is read. The set is
#: the one the schema editor offers, plus the symbols those codes are written
#: with. Anything else is left in place, so it fails to parse and the original
#: value survives rather than a number being invented from it.
_CURRENCY_NOISE = re.compile(r"(?i)USD|EUR|GBP|INR|JPY|[$₹€£¥,\s]")


def _amount(value: Any) -> Any:
    """A currency cell, read as leniently as it can honestly be read.

    The currency on a field describes the COLUMN, not each value, so a euro
    amount in a column marked USD is the user's to clean up — not a reason to
    mark the cell and fail the row. A cell that holds no legible amount comes
    back exactly as it arrived, rather than as None: a required field would
    then fail validation, which is the outcome this exists to avoid.
    """
    if isinstance(value, bool):
        raise InvalidInput("Boolean cannot be coerced to an amount", "TYPE_COERCION_FAILED")
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(_CURRENCY_NOISE.sub("", str(value)))
    except ValueError:
        return value
