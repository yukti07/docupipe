from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# The first six values are the backend contract. The remaining values are retained
# only for the worker's internal canonical representation and are normalized on write.
FieldType = Literal["text", "number", "date", "currency", "boolean", "list", "string", "integer", "datetime", "array", "object", "null"]


class SchemaStatus(StrEnum):
    DRAFT = "DRAFT"
    READY_FOR_REVIEW = "READY_FOR_REVIEW"
    APPROVED = "APPROVED"


class RunStatus(StrEnum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class SourceFile(BaseModel):
    id: str
    request_id: str
    user_id: str
    bucket: str
    object_key: str
    filename: str
    mime_type: str
    size_bytes: int = Field(ge=0)


class SchemaField(BaseModel):
    name: str = Field(min_length=1)
    type: FieldType
    required: bool = False
    description: str | None = None
    aliases: list[str] = Field(default_factory=list)
    fields: list["SchemaField"] = Field(default_factory=list)
    item_type: FieldType | None = None
    item_fields: list["SchemaField"] = Field(default_factory=list)

    @field_validator("aliases")
    @classmethod
    def aliases_are_nonempty(cls, value: list[str]) -> list[str]:
        if any(not alias.strip() for alias in value):
            raise ValueError("aliases cannot be blank")
        return value

    @model_validator(mode="after")
    def validate_shape(self) -> "SchemaField":
        if self.type == "object" and not self.fields:
            raise ValueError("object fields must define nested fields")
        if self.type == "array" and not self.item_type:
            raise ValueError("array fields must define item_type")
        return self


class Schema(BaseModel):
    name: str = Field(min_length=1)
    fields: list[SchemaField] = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def unique_names(self) -> "Schema":
        names = [field.name.casefold() for field in self.fields]
        if len(names) != len(set(names)):
            raise ValueError("schema field names must be unique")
        return self


class SchemaVersion(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: str
    file_schema_id: str
    request_id: str
    file_id: str
    version: int = Field(ge=1)
    status: SchemaStatus
    schema_definition: Schema = Field(alias="schema", serialization_alias="schema")
    source: str
    created_at: datetime | None = None


class SourceReference(BaseModel):
    row_number: int | None = None
    sheet_name: str | None = None
    json_path: str | None = None


class CanonicalRecord(BaseModel):
    values: dict[str, Any]
    source_reference: SourceReference | None = None


class CanonicalDocument(BaseModel):
    text: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class ProcessingRun(BaseModel):
    id: str
    request_id: str
    file_id: str
    file_schema_version_id: str
    status: RunStatus
    records_total: int = 0
    records_processed: int = 0
    records_failed: int = 0
    llm_calls: int = 0
    llm_repairs: int = 0
    error_code: str | None = None
    error_message: str | None = None


class StructuredRecord(BaseModel):
    processing_run_id: str
    record_number: int
    data: dict[str, Any]
    status: str = "VALID"


class RecordError(BaseModel):
    processing_run_id: str
    record_number: int
    field_name: str | None = None
    error_code: str
    message: str
    raw_value: Any = None


class SchemaDetectionContext(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    source_file: SourceFile
    local_path: str
    sample: Any = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    statistics: dict[str, Any] = Field(default_factory=dict)
    extracted_text: str | None = None


class ProcessingResult(BaseModel):
    records_total: int = 0
    records_processed: int = 0
    records_failed: int = 0


Scalar = str | int | float | bool | date | datetime | None
