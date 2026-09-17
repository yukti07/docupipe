# Zamp structured-data POC

Two independently deployable FastAPI workers implement the P0 workflow: schema detection and schema-approved data processing. CSV, JSON, and XLSX are supported. The workers accept authenticated Pub/Sub push envelopes on `POST /` and expose `GET /health`.

## Architecture

`schema-detector` resolves a MIME detector, downloads the source through `ObjectStorage`, validates the candidate schema, and writes a new immutable `schema_versions` record. `data-processor` resolves a MIME reader, loads the exact approved schema version, maps/coerces/validates records, and writes records and record errors separately.

The workers use the backend-owned PostgreSQL tables: `users`, `requests`, `files`, `file_schemas`, `file_schema_results`, `file_events`, and `request_outbox`. The backend must also create the worker tables documented in [docs/worker_missing_tables.md](docs/worker_missing_tables.md). Pub/Sub events carry identifiers only, never file paths or content.

The browser/API persists each schema edit through `SchemaRepository.persist_user_edit`, then calls `SchemaRepository.approve`. Both create immutable rows in `file_schema_versions`. Only the resulting `APPROVED` version can be referenced by a processing run.

## Run locally

Copy `.env.example` to `.env` and `config/config.example.yaml` to `config/config.yaml`. Put secrets such as `ZAMP_DATABASE_URL` only in `.env`; keep non-secret limits and logging settings in `config/config.yaml`. Both files are excluded from Git. For local GCS access, run `gcloud auth application-default login`; Compose mounts the resulting local ADC credential into the containers read-only. Then run:

```powershell
docker compose up --build
```

Workers listen on ports 8080 and 8081. Cloud Run deployment should build from `python/` with either worker Dockerfile, attach a service account (ADC), set `ZAMP_DATABASE_URL` from Secret Manager, and configure Pub/Sub authenticated push subscriptions. Keep Cloud Run `min-instances=0`, `max-instances=1`, and concurrency `1` for the POC.

`cloudbuild.yaml` publishes immutable commit-SHA image tags to Artifact Registry. Deploy each image to its own Cloud Run service in `us-central1`; the existing services are `zamp-schema-detector` and `zamp-data-processor`. Grant each Pub/Sub push service account only Cloud Run Invoker on its matching service. Both workers need GCS read and write access on the `zamptestbucket` upload bucket: the detector writes the detected-schema artifact under `uploads/<requestId>/schema/`, and the processor writes the run summary under `uploads/<requestId>/processing/`.

## Events

Schema detection payload:

```json
{"eventType":"SCHEMA_DETECTION_REQUESTED","requestId":"request_123","fileId":"file_123"}
```

Processing payload:

```json
{"eventType":"PROCESSING_REQUESTED","requestId":"request_123","fileId":"file_123","processingRunId":"run_123","fileSchemaVersionId":"schema-v2"}
```

Permanent domain failures are recorded/acknowledged to avoid Pub/Sub retry loops. Dependency failures return a non-2xx response and are retryable. The uniqueness constraint on `(processing_run_id, record_number)` makes duplicate delivery safe.

## Test

Use Python 3.12 (the Docker image runtime) and install the worker dependencies, then point the local smoke test at a file:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
py -3.12 -m pip install -e .\python\shared
py -3.12 -m pip install -r .\python\schema-detector\requirements.txt -r .\python\data-processor\requirements.txt -r .\tests\requirements.txt
py -3.12 .\scripts\smoke_test.py 'C:\path\to\customers.csv'
```

The smoke test accepts `.csv`, `.json`, and `.xlsx`, uses `FakeObjectStorage` plus temporary SQLite, detects a candidate schema, creates an immutable approved version, processes the file, and prints the inferred schema, processing counters, and the first three persisted records. No file leaves your computer. Run `pytest` separately for the unit tests.
