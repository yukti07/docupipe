from __future__ import annotations

from typing import Any

import pandas as pd

from zamp_shared.domain import Schema, SchemaField


def infer_field(name: str, series: pd.Series) -> SchemaField:
    non_null = series.dropna()
    dtype = str(series.dtype)
    if pd.api.types.is_bool_dtype(series): field_type = "boolean"
    elif pd.api.types.is_integer_dtype(series): field_type = "integer"
    elif pd.api.types.is_float_dtype(series): field_type = "number"
    else: field_type = "string"
    return SchemaField(name=str(name), type=field_type, required=not series.isna().any(), description=None)


def schema_from_dataframe(frame: pd.DataFrame, name: str, metadata: dict[str, Any] | None = None) -> Schema:
    fields = [infer_field(column, frame[column]) for column in frame.columns]
    stats = {
        str(column): {
            "dtype": str(frame[column].dtype),
            "null_percentage": round(float(frame[column].isna().mean() * 100), 2),
            "unique_count": int(frame[column].nunique(dropna=True)),
            "sample_values": [json_safe(value) for value in frame[column].dropna().head(5).tolist()],
        }
        for column in frame.columns
    }
    return Schema(name=name, fields=fields, metadata={**(metadata or {}), "statistics": stats})


def json_safe(value: Any) -> Any:
    return value.item() if hasattr(value, "item") else value

