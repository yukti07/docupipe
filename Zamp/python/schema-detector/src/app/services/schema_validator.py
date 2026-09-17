from zamp_shared.domain import Schema


class SchemaValidator:
    def validate(self, schema: Schema) -> Schema:
        # Pydantic construction enforces all P0 schema invariants; round-trip catches untrusted adapters.
        return Schema.model_validate(schema.model_dump(mode="json"))

