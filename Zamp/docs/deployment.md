# Running the workers locally and on GCP

Covers three ways to run the workers, then what has to exist in GCP and which identity gets which
permission. `scripts/setup_gcp.sh` automates the GCP half.

---

## Part 1 — Running locally

Three options, cheapest first. Pick based on what you actually need to exercise.

### Option A — Smoke test (no Docker, no GCP, no database)

The fastest way to see both pipelines run. Uses `FakeObjectStorage` and a temporary SQLite database,
so nothing leaves your machine.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
py -3.12 -m pip install -e .\python\shared
py -3.12 -m pip install -r .\python\schema-detector\requirements.txt -r .\python\data-processor\requirements.txt
py -3.12 .\scripts\smoke_test.py 'C:\path\to\customers.csv'
```

Accepts `.csv`, `.json`, `.xlsx`. Prints the inferred schema, processing counters, and the first three
persisted records. **Python 3.12 is required** — the code uses `StrEnum` (3.11+) and the Docker image
is `python:3.12-slim`.

This exercises the pipeline classes directly. It does not exercise the FastAPI handlers, Pub/Sub
envelope decoding, Postgres, or GCS.

### Option B — Docker Compose (real HTTP handlers, real Postgres, real GCS)

This is the closest local mirror of Cloud Run. Three things are worth knowing before you start:

- **The workers never create their own database tables.** Only `scripts/smoke_test.py` does, against
  SQLite. A fresh `docker compose up` gives you an empty Postgres, and the first request fails with
  `relation "files" does not exist`. Use `scripts/local_bootstrap.py seed` to create them.
- **`GCSObjectStorage` is hardcoded** in both `main.py` files with no config switch, so Compose always
  needs a real bucket and working ADC. There is no fully offline mode.
- **The workers read `bucket` and `object_key` from the `files` row, never from the message.** So a row
  has to exist and point at a real object before any event will do anything.

Setup:

```powershell
Copy-Item .env.example .env
Copy-Item config\config.example.yaml config\config.yaml
gcloud auth application-default login        # Compose mounts this ADC credential read-only
```

Edit `.env` — set `ZAMP_GCP_PROJECT_ID` and pick a `POSTGRES_PASSWORD`. Keep `ZAMP_DATABASE_URL`
pointing at the `postgres` service hostname; that is what the containers use.

Upload a file and seed the row it describes:

```powershell
gcloud storage cp customers.csv gs://YOUR_BUCKET/uploads/request_local/input/customers.csv
docker compose up --build -d

# Note: from the host, not the container -- so localhost, not the 'postgres' hostname in .env
$env:ZAMP_DATABASE_URL = "postgresql+psycopg://zamp:YOUR_PASSWORD@localhost:5432/zamp"
py -3.12 .\scripts\local_bootstrap.py seed --bucket YOUR_BUCKET `
  --object-key uploads/request_local/input/customers.csv
```

That prints the schema-detection envelope. POST it to the detector on port 8080, take the
`schemaVersionId` it returns, then:

```powershell
py -3.12 .\scripts\local_bootstrap.py approve --schema-version-id <id>
```

That approves the version, creates the processing run, and prints the processing envelope for the
data processor on port 8081. Approval and run creation are backend responsibilities with no endpoint
on either worker, which is why the helper exists.

Health checks: `curl http://localhost:8080/health` and `:8081/health`.

### Option C — Unit tests

```powershell
py -3.12 -m pip install -r .\tests\requirements.txt
py -3.12 -m pytest
```

`tests/conftest.py` puts `python/shared/src` and `python/schema-detector/src` on the path.

### Local gotchas

| Symptom | Cause |
|---|---|
| `relation "files" does not exist` | Tables were never created. Run `local_bootstrap.py seed`. |
| `503 Worker dependency unavailable` | `ZAMP_DATABASE_URL` is unset or unreachable — `main.py:29` raises when it is missing. |
| `DefaultCredentialsError` | ADC not mounted. Run `gcloud auth application-default login` and restart Compose. |
| `{"status":"failed","errorCode":"UNSUPPORTED_MIME_TYPE"}` | See finding B2 — the registry does not strip `; charset=utf-8` or fall back to file extension. |
| `{"status":"failed","errorCode":"FILE_NOT_FOUND"}` | No `files` row, or its `bucket`/`object_key`/`size_bytes` is null. |
| Config changes appear ignored | `gcp.storage_bucket` is declared in config but never read anywhere. The bucket comes from the `files` row. |

---

## Part 2 — What has to exist in GCP

Everything below is created by `scripts/setup_gcp.sh`. The console equivalents are listed so you can
verify or do it by hand.

| # | Resource | Console location |
|---|---|---|
| 1 | Enable Run, Artifact Registry, Cloud Build, Pub/Sub, Storage, Secret Manager, Cloud SQL Admin, IAM Credentials | APIs & Services → Library |
| 2 | Artifact Registry Docker repo in `us-central1` | Artifact Registry → Repositories |
| 3 | GCS bucket with uniform bucket-level access | Cloud Storage → Buckets |
| 4 | Four service accounts (see the matrix below) | IAM & Admin → Service Accounts |
| 5 | Cloud SQL Postgres 16 instance, database, user | SQL → Instances |
| 6 | Secret holding the SQLAlchemy connection URL | Secret Manager |
| 7 | Two Cloud Run services, unauthenticated access **off** | Cloud Run |
| 8 | Three Pub/Sub topics: two request topics + one dead-letter | Pub/Sub → Topics |
| 9 | Two push subscriptions with OIDC auth and DLQ | Pub/Sub → Subscriptions |

Cloud Run settings per the POC brief in `README.md`: `min-instances=0`, `max-instances=1`,
`concurrency=1`. Set `timeout=600` to match the maximum Pub/Sub push ack deadline.

The database URL must use the Cloud SQL unix socket, not a host and port:

```
postgresql+psycopg://USER:PASSWORD@/zamp?host=/cloudsql/PROJECT:REGION:INSTANCE
```

and the service needs `--add-cloudsql-instances=PROJECT:REGION:INSTANCE` for that socket to be mounted.
A plain `host:5432` URL cannot reach Cloud SQL from Cloud Run without a Serverless VPC connector — this
was finding A6.

---

## Part 3 — Permissions: who gets what, and why

There are **five distinct identities**. Conflating them is the usual source of 403s.

### 1. Worker runtime service accounts

`zamp-schema-detector@…` and `zamp-data-processor@…` — the identity each Cloud Run service runs as.

| Role | Scope | Why |
|---|---|---|
| `roles/storage.objectUser` | the bucket | Read the source file **and write artifacts**. Both workers write: the detector writes the detected-schema JSON, the processor writes the run summary. |
| `roles/secretmanager.secretAccessor` | the DB URL secret | Read `ZAMP_DATABASE_URL` at startup. |
| `roles/cloudsql.client` | project | Connect through the Cloud SQL socket. |
| `roles/logging.logWriter` | project | Custom runtime SAs do not get this implicitly. |

> **Why `objectUser` and not `objectCreator`.** `objectCreator` cannot overwrite an existing object.
> Since the A1 fix, a retried detection re-uploads the *same* object key, which requires delete as well
> as create. `objectCreator` alone would make every retry 403. If your org forbids `objectUser`, use
> `roles/storage.objectAdmin` on the bucket.

> The README originally said the detector needed read-only access. That was wrong and caused A1 — the
> detector 403'd on upload after its schema row had already committed, stranding the file silently.

### 2. Pub/Sub push service accounts

`zamp-push-schema@…` and `zamp-push-processing@…` — the identity each *subscription* signs its OIDC
token as.

| Role | Scope | Why |
|---|---|---|
| `roles/run.invoker` | **one** Cloud Run service each | Call that service. Scoped per service so a compromised subscription cannot invoke the other worker. |

Keeping these separate from the runtime accounts is what makes "only Cloud Run Invoker on its matching
service" in the README actually true.

### 3. The Pub/Sub service agent

`service-PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com` — Google-managed, created on demand.

| Role | Scope | Why |
|---|---|---|
| `roles/iam.serviceAccountTokenCreator` | each push SA | **Most commonly missed.** Without it Pub/Sub cannot mint OIDC tokens as the push identities and every delivery 403s. |
| `roles/pubsub.publisher` | the dead-letter topic | Move exhausted messages to the DLQ. |
| `roles/pubsub.subscriber` | each push subscription | Ack the message it forwarded to the DLQ. |

If the agent does not exist yet, force it: `gcloud beta services identity create --service=pubsub.googleapis.com`.

### 4. The Cloud Build service account

Needs `roles/artifactregistry.writer` and `roles/logging.logWriter`. On projects created after April
2024 builds run as the Compute Engine default SA, which often has neither — grant them explicitly or
pass a dedicated `--service-account`.

If you later deploy from Cloud Build rather than by hand, it also needs `roles/run.admin` and
`roles/iam.serviceAccountUser` on both runtime SAs.

### 5. The backend publisher

Whatever publishes the outbox events needs `roles/pubsub.publisher` on `file-uploaded`
and `convert-requested`. The script leaves this as a manual step since the identity is yours.

And you, running the setup: project Owner, or Editor plus Project IAM Admin. Deploying Cloud Run with
`--service-account` also requires `iam.serviceAccounts.actAs` on the runtime SAs.

---

## Part 4 — The script

`scripts/setup_gcp.sh` provisions all of Part 2 and Part 3. It is **dry run by default** — it prints
every command and creates nothing until you pass `--apply`. It is idempotent, so re-running after a
partial failure skips what already exists.

Easiest from **Cloud Shell**, where gcloud is already authenticated:

```bash
PROJECT_ID=your-project BUCKET=your-bucket ./scripts/setup_gcp.sh            # inspect
PROJECT_ID=your-project BUCKET=your-bucket ./scripts/setup_gcp.sh --apply    # execute
```

Overridable: `REGION` (`us-central1`), `REPOSITORY`, `SQL_INSTANCE`, `SQL_TIER`, `DB_NAME`, `DB_USER`,
`SECRET_NAME`, `TAG`.

The database password is generated with `secrets.token_urlsafe(32)`, written straight into Secret
Manager, and never echoed or stored on disk. On re-runs an existing secret is left untouched.

### What the script deliberately leaves to you

1. **Creating the database tables.** No migration runner exists in this repo and the workers do not
   create tables at startup. Apply `docs/worker_missing_tables.md` plus the backend's own tables via
   `gcloud sql connect`.
2. **Granting the backend publisher role**, since that identity is specific to your setup.
3. **Verification** (below).

### Known wrinkle

`cloudbuild.yaml` uses the user-defined `${_TAG}` substitution, so manual builds and deployments use
the same immutable image tag.

---

## Part 5 — Verifying the deployment

Both services reject unauthenticated calls, so mint a token:

```bash
TOKEN=$(gcloud auth print-identity-token)
URL=$(gcloud run services describe zamp-schema-detector --region=us-central1 --format='value(status.url)')
curl -H "Authorization: Bearer $TOKEN" "$URL/health"
# {"status":"ok","service":"schema-detector"}
```

A 403 means your own account lacks `roles/run.invoker` — grant it temporarily. A 503 means
`ZAMP_DATABASE_URL` is not resolving; check the secret binding and `--add-cloudsql-instances`.

End to end: upload a file, insert its `files` row, then publish:

```bash
gcloud pubsub topics publish file-uploaded \
  --message='{"eventType":"SCHEMA_DETECTION_REQUESTED","requestId":"request_123","fileId":"file_123"}'
```

Watch it land:

```bash
gcloud run services logs read zamp-schema-detector --region=us-central1 --limit=50
```

A message landing in `file-uploaded-dlq` or `convert-requested-dlq` after five attempts means a poison
payload — expected for the
failure classes in finding A4 until those are converted to `DomainError`.
