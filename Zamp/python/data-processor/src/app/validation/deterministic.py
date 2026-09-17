from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from zamp_shared.domain import Schema


@dataclass(frozen=True)
class ValidationIssue:
    field_name: str
    error_code: str
    message: str
    raw_value: Any


class DeterministicValidator:
    def validate(self, data: dict[str, Any], schema: Schema) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        for field in schema.fields:
            if field.required and data.get(field.name) is None:
                issues.append(ValidationIssue(field.name, "REQUIRED_FIELD_MISSING", f"{field.name} is required", None))
        return issues

