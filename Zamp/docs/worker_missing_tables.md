# Worker tables required in addition to the backend schema

The backend's `users`, `requests`, `files`, `file_schemas`, `file_schema_results`, `file_events`, and `request_outbox` tables are the system of record. Do not create parallel `jobs`, `source_files`, or `schema_versions` tables.

The Python workers require the following four tables to preserve schema approval, processing reproducibility, record output, and record-level errors.

## 1. `file_schema_versions`

`file_schemas` identifies a detected table/sheet, but its `UNIQUE(file_id, table_ord)` constraint means it cannot preserve each edit and approval as an immutable row. This table supplies that history.

```sql
CREATE TYPE file_schema_version_status AS ENUM ('READY_FOR_REVIEW', 'APPROVED');

CREATE TABLE file_schema_versions (
  id             text PRIMARY KEY,
  file_schema_id text NOT NULL REFERENCES file_schemas(id) ON DELETE CASCADE,
  request_id     text NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  file_id        text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  version        integer NOT NULL,
  status         file_schema_version_status NOT NULL DEFAULT 'READY_FOR_REVIEW',
  fields         jsonb NOT NULL,
  schema_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  source         text NOT NULL CHECK (source IN ('DETERMINISTIC', 'USER_EDITED', 'USER_APPROVED')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_schema_id, version)
);

CREATE INDEX file_schema_versions_file_idx ON file_schema_versions (file_id, created_at DESC);
CREATE INDEX file_schema_versions_approved_idx ON file_schema_versions (file_schema_id, version DESC)
  WHERE status = 'APPROVED';
```

The detector inserts version `1` with `source = 'DETERMINISTIC'`. Every user edit inserts a new `READY_FOR_REVIEW` version. Approval inserts a new `APPROVED` version. Existing version rows must never be updated.

## 2. `processing_runs`

Each run references the exact approved version used for processing.

```sql
CREATE TYPE processing_run_status AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE processing_runs (
  id                     text PRIMARY KEY,
  request_id             text NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  file_id                text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  file_schema_version_id text NOT NULL REFERENCES file_schema_versions(id),
  status                 processing_run_status NOT NULL DEFAULT 'PENDING',
  records_total          integer NOT NULL DEFAULT 0,
  records_processed      integer NOT NULL DEFAULT 0,
  records_failed         integer NOT NULL DEFAULT 0,
  llm_calls              integer NOT NULL DEFAULT 0,
  llm_repairs            integer NOT NULL DEFAULT 0,
  error_code             text,
  error_message          text,
  started_at             timestamptz,
  completed_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX processing_runs_request_idx ON processing_runs (request_id, created_at DESC);
CREATE INDEX processing_runs_file_idx ON processing_runs (file_id, created_at DESC);
```

The backend creates this row and writes an outbox event only after the selected schema version is approved. The worker only changes run status and counters.

## 3. Per-file structured record tables

Each file gets its own physical structured-record table. The worker derives the table name as
`structured_records_<first 24 hex characters of SHA-256(file_id)>`; this keeps PostgreSQL identifiers
safe and bounded while ensuring different files never share record rows.

The table shape is the same for every file; the file-specific schema is represented by its JSONB `data`
column and the corresponding approved row in `file_schema_versions`.

```sql
CREATE TABLE structured_records_<file_id_hash> (
  id                text PRIMARY KEY,
  processing_run_id text NOT NULL REFERENCES processing_runs(id) ON DELETE CASCADE,
  record_number     integer NOT NULL,
  data              jsonb NOT NULL,
  status            text NOT NULL DEFAULT 'VALID',
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (processing_run_id, record_number)
);

CREATE INDEX structured_records_<file_id_hash>_run_idx ON structured_records_<file_id_hash> (processing_run_id, record_number);
```

The uniqueness constraint is required: Pub/Sub can redeliver messages, and repeated processing must not duplicate records.

## 4. `record_errors`

```sql
CREATE TABLE record_errors (
  id                text PRIMARY KEY,
  processing_run_id text NOT NULL REFERENCES processing_runs(id) ON DELETE CASCADE,
  record_number     integer NOT NULL,
  field_name        text,
  error_code        text NOT NULL,
  message           text NOT NULL,
  raw_value         jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX record_errors_run_idx ON record_errors (processing_run_id, record_number);
```

## Worker event contracts

The backend owns row creation and publishes the events through `request_outbox`. The workers do not trust a GCS path from a message; they load `bucket` and `object_key` from `files`.

```json
{"eventType":"SCHEMA_DETECTION_REQUESTED","requestId":"request_123","fileId":"file_123"}
```

```json
{"eventType":"PROCESSING_REQUESTED","requestId":"request_123","fileId":"file_123","processingRunId":"run_123","fileSchemaVersionId":"schema_version_123"}
```

Before publishing the processing event, verify that `file_schema_versions.status = 'APPROVED'` and that the schema version belongs to the event's file and request.
