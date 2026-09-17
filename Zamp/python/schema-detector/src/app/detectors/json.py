from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any

from zamp_shared.domain import Schema, SchemaDetectionContext, SchemaField
from zamp_shared.errors import InvalidInput
from .base import SchemaDetector


class JsonSchemaDetector(SchemaDetector):
    def detect(self, context: SchemaDetectionContext) -> Schema:
        with open(context.local_path, encoding="utf-8") as stream: data = json.load(stream)
        name, records = self._records(data, context.source_file.filename)
        if not records: raise InvalidInput("JSON must contain at least one object record")
        return Schema(name=name, fields=self._object_fields(records), metadata={"format": "json", "sample_records": len(records)})

    def _records(self, data: Any, filename: str) -> tuple[str, list[dict[str, Any]]]:
        if isinstance(data, list):
            if not all(isinstance(item, dict) for item in data): raise InvalidInput("Top-level JSON array must contain objects")
            return filename.rsplit(".", 1)[0] or "records", data
        if isinstance(data, dict):
            arrays = [(name, value) for name, value in data.items() if isinstance(value, list) and all(isinstance(item, dict) for item in value)]
            if len(arrays) == 1: return arrays[0]
        raise InvalidInput("JSON must be an object array or an object with one object array")

    def _object_fields(self, records: list[dict[str, Any]]) -> list[SchemaField]:
        keys = list(dict.fromkeys(key for record in records for key in record))
        return [self._field(key, [record.get(key) for record in records], all(key in record and record[key] is not None for record in records)) for key in keys]

    def _field(self, name: str, values: list[Any], required: bool) -> SchemaField:
        present = [value for value in values if value is not None]
        if not present: return SchemaField(name=name, type="null", required=False)
        kinds = {self._type(value) for value in present}
        field_type = kinds.pop() if len(kinds) == 1 else "string"
        if field_type == "object":
            return SchemaField(name=name, type="object", required=required, fields=self._object_fields([value for value in present if isinstance(value, dict)]))
        if field_type == "array":
            items = [item for value in present for item in value]
            item_types = {self._type(item) for item in items}
            item_type = item_types.pop() if len(item_types) == 1 else "string"
            item_fields = self._object_fields([item for item in items if isinstance(item, dict)]) if item_type == "object" else []
            return SchemaField(name=name, type="array", required=required, item_type=item_type, item_fields=item_fields)
        return SchemaField(name=name, type=field_type, required=required)

    @staticmethod
    def _type(value: Any) -> str:
        if isinstance(value, bool): return "boolean"
        if isinstance(value, int): return "integer"
        if isinstance(value, float): return "number"
        if isinstance(value, str): return "string"
        if isinstance(value, list): return "array"
        if isinstance(value, dict): return "object"
        return "null"

