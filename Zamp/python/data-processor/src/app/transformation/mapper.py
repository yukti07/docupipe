from __future__ import annotations

from zamp_shared.domain import Schema


class SchemaMapper:
    def map(self, source_values: dict[str, object], schema: Schema) -> dict[str, object]:
        # Exact field name wins; aliases make user-approved renames deterministic.
        lookup = {key.casefold(): value for key, value in source_values.items()}
        output: dict[str, object] = {}
        for field in schema.fields:
            candidates = (field.name, *field.aliases)
            output[field.name] = next((lookup[candidate.casefold()] for candidate in candidates if candidate.casefold() in lookup), None)
        return output

