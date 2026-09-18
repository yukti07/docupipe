# Zamp structured-data POC

Two independently deployable FastAPI workers implement the P0 workflow: schema detection and schema-approved data processing. CSV, JSON, XLSX and images (PNG, JPEG, WebP, BMP, TIFF, HEIC/HEIF) are supported end to end. An image goes to Gemini twice: once to infer the structure it represents rather than transcribing it, and once more against the approved schema to read the values out. See [docs/data-format-workflow.md](docs/data-format-workflow.md). The workers accept authenticated Pub/Sub push envelopes on `POST /` and expose `GET /health`.

## Architecture

`schema-detector` resolves a MIME detector, downloads the source through `ObjectStorage`, validates the candidate schema, and writes a new immutable `schema_versions` record. `data-processor` resolves a MIME reader, loads the exact approved schema version, maps/coerces/validates records, and writes records and record errors separately.

The workers use the backend-owned PostgreSQL tables: `users`, `requests`, `files`, `file_schemas`, `file_schema_results`, `file_events`, and `request_outbox`. The backend must also create the worker tables documented in [docs/worker_missing_tables.md](docs/worker_missing_tables.md). Pub/Sub events carry identifiers only, never file paths or content.

The browser/API persists each schema edit through `SchemaRepository.persist_user_edit`, then calls `SchemaRepository.approve`. Both create immutable rows in `file_schema_versions`. Only the resulting `APPROVED` version can be referenced by a processing run.

## Run locally

Copy `.env.example` to `.env` and `config/config.example.yaml` to `config/config.yaml`. Put secrets such as `ZAMP_DATABASE_URL` and `ZAMP_LLM_API_KEY` only in `.env`; keep non-secret limits and logging settings in `config/config.yaml`. Prompts live in `python/prompts` so they are inside the Docker build context; the default `prompts_dir` resolves against the image's `/app` working directory, so a run started from the repo root needs `ZAMP_SCHEMA_PROMPTS_DIR=python/prompts`. Both files are excluded from Git. For local GCS access, run `gcloud auth application-default login`; Compose mounts the resulting local ADC credential into the containers read-only. Then run:

```powershell
docker compose up --build
```

Workers listen on ports 8080 and 8081. Cloud Run deployment should build from `python/` with either worker Dockerfile, attach a service account (ADC), set `ZAMP_DATABASE_URL` from Secret Manager, and configure Pub/Sub authenticated push subscriptions. Keep Cloud Run `min-instances=0`, `max-instances=1`, and concurrency `1` for the POC.

`cloudbuild.yaml` publishes immutable commit-SHA image tags to Artifact Registry. `_REGION` selects the registry and defaults to `us-central1`, so a deploy for the live services must override it:

```powershell
gcloud builds submit . --config cloudbuild.yaml --substitutions _REGION=asia-south1,_TAG=$(git rev-parse HEAD)
```

**The live services are `quarry-inspect-worker` and `quarry-convert-worker`, in `asia-south1`.** They are the only ones Pub/Sub pushes to — `quarry-file-uploaded-push` and `quarry-convert-requested-push` are the sole push subscriptions on `file-uploaded` and `convert-requested` — and they pull from the `asia-south1` copy of the `zamp` registry. `zamp-schema-detector` and `zamp-data-processor` in `us-central1` still exist but receive no traffic; treat them as abandoned rather than as the deployment target.

Grant each Pub/Sub push service account only Cloud Run Invoker on its matching service. Both workers need GCS read and write access on the `zamptestbucket` upload bucket: the detector writes the detected-schema artifact under `uploads/<requestId>/schema/`, and the processor writes the run summary under `uploads/<requestId>/processing/`.

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

For an image, `scripts/image_roundtrip.py` runs the whole feature against one file:

```powershell
py -3.12 .\scripts\image_roundtrip.py 'C:\path\to\table.png'
```

It detects the schema, validates it, reads the records back out against that schema, and prints the schema, the records, and the per-record counters. It needs `ZAMP_LLM_API_KEY`, which it reads from `.env`, and it sends that one image to Gemini twice — once for the shape, once for the values. Nothing else leaves your computer and the key is never printed. It uses the real detector, reader, mapper, coercer and validator, but no database: the lease statement in `FileRepository.claim` is PostgreSQL-only, so the durable layer cannot run on SQLite.

`scripts/smoke_test.py` covers the full durable path for `.csv`, `.json` and `.xlsx`. **It is currently broken** — it imports `StructuredRecordRow`, which no longer exists, and calls both pipelines with signatures that predate the lease and outbox work. Repairing it needs a real PostgreSQL rather than the temporary SQLite it assumes.

Run `pytest` separately for the unit tests.
