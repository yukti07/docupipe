# Supported Formats and Processing Workflow

## Supported formats

The workers support CSV, JSON, and XLSX files.

| Format | Detection | Processing |
|---|---|---|
| CSV | Samples configured rows with pandas and infers names, types, requiredness, and statistics. | Streams rows in chunks, then maps, coerces, and validates each row. |
| JSON | Accepts a top-level object array or one object array nested under a property. | Reads each object as one canonical record and preserves its JSON path. |
| XLSX | Selects the first non-empty worksheet and infers its columns from sample rows. | Reads the first non-empty worksheet and preserves row/sheet references. |

Supported MIME types are `text/csv`, `application/csv`, `application/json`, and
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.

## Unknown-format fallback

Known formats use deterministic local detectors. When the MIME type and extension have no registered
detector, the registry uses Gemini only when `ZAMP_LLM_ENABLED=true`, `ZAMP_LLM_PROVIDER=gemini`, and
`ZAMP_LLM_API_KEY` is configured. The worker sends a bounded UTF-8 sample to Google AI Studio's Gemini
`generateContent` API with temperature zero and JSON response mode.

The prompt requires exactly one `{schema, metadata}` JSON envelope. The parser accepts raw JSON, fenced
JSON, or JSON surrounded by prose, scans with `JSONDecoder.raw_decode`, then validates the extracted
schema through the same Pydantic `Schema` model used by deterministic detectors. Invalid or empty model
responses become explicit `GEMINI_*` domain errors; they are never persisted as a schema.

## Detection flow

1. The backend uploads the object to GCS and writes its bucket, object key, MIME type, size, request ID, and user ID to `files`.
2. It publishes `SCHEMA_DETECTION_REQUESTED` to `file-uploaded` with only `requestId` and `fileId`.
3. Pub/Sub pushes the authenticated envelope to `quarry-inspect-worker`.
4. The worker loads file metadata from PostgreSQL, downloads the object, selects the detector by MIME type, and infers/validates the schema.
5. It writes immutable version 1 to `file_schema_versions` with `READY_FOR_REVIEW`, plus the parent `file_schemas` and detection result.

## Review and conversion flow

1. The backend presents the schema for review. Edits create new immutable versions.
2. Approval creates an immutable `APPROVED` version; the detected version is not mutated.
3. The backend creates a `PENDING` `processing_runs` row referencing that exact approved version.
4. It publishes `PROCESSING_REQUESTED` to `convert-requested` with request ID, file ID, run ID, and schema version ID.
5. Pub/Sub pushes the event to `quarry-convert-worker`.
6. The worker reloads the run, file, and approved schema, downloads the same GCS object, reads records, maps fields, coerces types, validates them, and writes records or errors.
7. Successful records go to `structured_records_<file_id_hash>`, a physical table dedicated to that file. Its `data` column is JSONB, so different files can have different fields without changing DDL.
8. The worker writes the summary artifact, updates run counters/status, and marks the file `COMPLETED`; failures mark the file/run `FAILED` with an error code.

## Multiple files per request

Yes. Five files can have five different schemas. Each file has its own file row, schema/version history,
approved version, processing run, and `structured_records_<file_id_hash>` table. A conversion event must
reference the specific file and approved schema version; schemas are not shared merely because files
belong to the same request.

## Operational guarantees

- Messages contain identifiers, never file paths or content.
- Processing runs are created before conversion events are published.
- `(processing_run_id, record_number)` is unique inside each per-file table, making Pub/Sub redelivery safe.
- Table names are derived from a SHA-256 hash of `file_id`, not raw user input.