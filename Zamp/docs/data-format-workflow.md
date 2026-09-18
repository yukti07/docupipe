# Supported Formats and Processing Workflow

## Supported formats

The workers support CSV, JSON, XLSX and image files.

| Format | Detection | Processing |
|---|---|---|
| CSV | Samples configured rows with pandas and infers names, types, requiredness, and statistics. | Streams rows in chunks, then maps, coerces, and validates each row. |
| JSON | Accepts a top-level object array or one object array nested under a property. | Reads each object as one canonical record and preserves its JSON path. |
| XLSX | Selects the first non-empty worksheet and infers its columns from sample rows. | Reads the first non-empty worksheet and preserves row/sheet references. |
| Image | Sends the image itself to Gemini and infers the structure it represents. | Sends the image again with the approved schema and reads the values out of it. |

Supported MIME types are `text/csv`, `application/csv`, `application/json`,
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `image/png`, `image/jpeg`,
`image/webp`, `image/bmp`, `image/tiff`, `image/heic` and `image/heif`.

## Image schema detection

Images route to `GeminiImageSchemaDetector`, registered against each image MIME type, and are
available only when `ZAMP_LLM_ENABLED=true`, `ZAMP_LLM_PROVIDER=gemini`, and `ZAMP_LLM_API_KEY` is
configured. None of the three is set on `quarry-inspect-worker` or `quarry-convert-worker` today, so
deploying the image alone does not switch this on: with the LLM unconfigured no image detector is
registered at all and every image fails `format_unsupported`. The key belongs in Secret Manager
alongside `zamp-database-url`, not in a plain environment variable.

The image is sent to Gemini as image data, not as extracted text. There is no OCR step and no
Document AI call anywhere in this path. That is deliberate: column alignment, label-to-value
adjacency, repeated row positions and table boundaries are the evidence a schema is read from, and
extracting text first destroys all of it. The prompt in `python/prompts/schema/schema_from_image.txt`
tells the model it is a schema extraction engine rather than a transcription engine, ranks the
structural evidence it should look for, states that a table needs no visible borders, and lists what
to ignore — logos, page numbers, watermarks, footers, and the UI chrome around a screenshot.

`image/bmp` and `image/tiff` are not accepted by Gemini as inline image data, so they are re-encoded
to PNG with Pillow before the request. The re-encode is lossless and applies no resizing or
compression, because resolution is what makes a photographed table readable as a table. Pillow is an
image codec here, never a text extractor. Every other format is sent byte-for-byte under its own MIME
type. Images larger than `ZAMP_SCHEMA_MAX_IMAGE_BYTES` are refused from the directory entry before
any bytes are read.

## Image record extraction

Conversion of an image routes to `GeminiImageReader`, registered against the same MIME types as the
detector and available under the same configuration conditions.

The image is sent a second time, now together with the approved schema, and the model is asked to
return one record per row or repeated block using the schema's own field names as keys. Only the
field name, type, requiredness and description are sent: aliases are withheld deliberately, because
the mapper resolves a record by field name first and offering the model an alias invites it to answer
under a key that then maps twice.

The prompt in `python/prompts/processing/records_from_image.txt` requires every schema field to be
present in every record, with `null` where the image shows no value, and forbids inventing,
calculating or carrying values between records. It also excludes header, totals and subtotal rows,
which are summaries of the records rather than records themselves.

Records come back through `app/services/record_parser.py`, which reuses the same shared JSON
extraction as the detector and accepts either a bare array or an object wrapping one. Each record
carries a `row_number` source reference, and then follows the normal path: `SchemaMapper` aligns it
to the approved schema, `TypeCoercer` converts each value to the field's type, and
`DeterministicValidator` checks it. A value the model returns in the wrong shape therefore fails as
an ordinary per-record coercion error rather than failing the whole run.

Unlike the streaming readers, this one makes a single request and holds the result: an image is one
page of records, not a file that has to be chunked. Zero records is treated as a failed read
(`EXTRACT_EMPTY`), because a schema was detected from this same image.

## Unknown-format fallback

Known formats use deterministic local detectors. When the MIME type and extension have no registered
detector, the registry falls back to Gemini under the same configuration conditions. PDFs and images
reaching this path are sent as inline file data; anything else is sent as a bounded UTF-8 sample.

## Parsing the model response

Everything Gemini returns is treated as untrusted external data. `app/services/schema_parser.py` is
the single place that turns it into a `Schema`:

    raw text -> extract -> normalize -> Schema.model_validate -> semantic checks -> Schema

Extraction strips markdown fences, tries a direct parse, then scans with `JSONDecoder.raw_decode` —
never a regex, which cannot find where a nested object ends — and scores the candidates it finds.
A response wrapped as `{"schema": {...}, "metadata": {...}}` is accepted and flattened here, and only
here; the canonical object everywhere else in the application is the root form
`{name, fields, metadata}`. A response that is a JSON string containing JSON is decoded once more,
never recursively.

Normalization is meaning-preserving only: unknown keys dropped, missing optional keys filled,
model-reported confidence coerced and clamped to `[0.0, 1.0]`. Confidence is what the model said
about itself and is not calibrated. Duplicate field names collapse only when the two definitions are
byte-for-byte identical; conflicting duplicates are rejected rather than merged, because merging
picks one meaning at random. Validation then runs the Pydantic `Schema` model followed by semantic
checks the model does not carry, chiefly uniqueness of field names at every nested level.

Invalid, empty or unparseable model responses become explicit `GEMINI_*` domain errors; they are
never persisted as a schema.

Transient provider failures — HTTP 408, 429 and 5xx — are retried up to `ZAMP_LLM_MAX_RETRIES` times
with exponential backoff and jitter, then surface as `TransientError` so the file is retried rather
than failed. Other 4xx responses are permanent and fail immediately. The API key travels in the
`x-goog-api-key` header, never in the query string, and is scrubbed from anything logged. Logs carry
the model, MIME type, byte counts, HTTP status, attempt number and a truncated provider error, never
image content or the full model response.

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