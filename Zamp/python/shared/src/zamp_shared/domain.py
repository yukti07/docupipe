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

    #: Which table inside the object this reference is to, when the object
    #: holds more than one. For a workbook that is a worksheet: the index is
    #: the identity and the name is provenance, because names are not stable
    #: enough to address by. Both are None for a format that holds one table,
    #: and a reader that needs them must refuse rather than guess.
    worksheet_index: int | None = Field(default=None, ge=0)
    worksheet_name: str | None = None

    def at_worksheet(self, index: int, name: str | None) -> "SourceFile":
        return self.model_copy(update={"worksheet_index": index, "worksheet_name": name})


class SchemaField(BaseModel):
    name: str = Field(min_length=1)
    type: FieldType
    required: bool = False

    #: Which currency this column's amounts are in, as an ISO code. It is an
    #: assertion about the COLUMN, made once on the schema, and never a check
    #: on a value: a euro amount in a column marked USD is a data-quality
    #: matter for the user, not a row this worker may reject. Only meaningful
    #: when `type` is "currency"; None everywhere else.
    currency: str | None = None
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


class DetectedTable(BaseModel):
    """One table found inside a source file, at its own ordinal.

    For a workbook the ordinal IS the worksheet index, which is what makes the
    identity deterministic under redelivery: `file_schemas` is unique on
    (file_id, table_ord), so the same sheet always resolves to the same row.
    """
    model_config = ConfigDict(populate_by_name=True)
    ord: int = Field(ge=0)
    label: str | None = None
    hidden: bool = False
    schema_definition: Schema | None = Field(default=None, alias="schema", serialization_alias="schema")

    #: Set instead of a schema when this table alone could not be read. The
    #: table still exists and still gets a row, so a sheet that yielded nothing
    #: is visible as such rather than missing.
    failure_code: str | None = None
    failure_detail: str | None = None


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
