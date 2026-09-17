from __future__ import annotations

import math
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
        if target_type in {"number", "currency"}: return float(str(value).replace(",", "").replace("$", "").replace("₹", ""))
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
