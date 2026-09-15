# Quarry worker

One image, two roles. `SERVICE_ROLE=inspect|convert` selects the processor at
startup; everything else — leasing, the outbox relay, the sweep, the failure
classes, the health endpoints — is identical in both.

```
file lands in GCS      →  file-uploaded      →  INSPECT  →  writes a schema
user presses Convert   →  convert-requested  →  CONVERT  →  writes output
Cloud Scheduler, 1/min →  /internal/sweep    →  either   →  recovers everything
```

## Running it

Nothing here needs a cloud account.

```bash
# from the repo root — Postgres, migrations, worker, and a stand-in scheduler
docker compose up --build

curl localhost:8080/health
curl localhost:8080/healthz
curl -X POST localhost:8080/internal/sweep
```

Standalone:

```bash
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt

export SERVICE_ROLE=inspect
export DATABASE_URL=postgresql://quarry:quarry@localhost:5432/quarry
export STORAGE_BACKEND=local LOCAL_STORAGE_ROOT=/tmp/quarry

.venv/bin/uvicorn src.main:app --port 8080
```

### Against real GCS and real Pub/Sub

Pub/Sub cannot push to a laptop, so a worker outside Cloud Run has to pull.
`PUBSUB_DELIVERY=pull` opens a streaming pull on the subscriptions below and
feeds them through the same parser and pipeline the push route uses; deployed
instances leave it unset and stay on push.

```bash
export SERVICE_ROLE=both
export STORAGE_BACKEND=gcs GCS_BUCKET_NAME=zamptestbucket
export GCP_PROJECT_ID=project-cf6fd144-baf2-463b-9cd
export PUBSUB_DELIVERY=pull
export PUBSUB_SUBSCRIPTION_FILE_UPLOADED=file-uploaded-local
export PUBSUB_SUBSCRIPTION_CONVERT_REQUESTED=convert-requested-local

.venv/bin/uvicorn src.main:app --port 8080
```

Credentials come from ADC, and signing a URL needs a credential with a
`client_email` — so ADC must impersonate a service account, not be a bare user
login. The subscription ack deadline must be at least `LEASE_SECONDS` or a
healthy worker gets its file stolen mid-run; both subscriptions are created at
600s, which is the Pub/Sub maximum and the `LEASE_SECONDS` default.

## Tests

```bash
.venv/bin/pytest                    # everything
.venv/bin/pytest tests/test_units.py  # no database needed
```

The queue tests run against a **real PostgreSQL**, from `TEST_DATABASE_URL` if
set and otherwise from testcontainers. With neither, they skip with a reason
rather than failing.

They cannot be written any other way. `FOR UPDATE SKIP LOCKED` and the
conditional-UPDATE claim are database behaviours, not application logic — a
mock would test our belief about PostgreSQL rather than PostgreSQL. The
fixtures apply the *real* migration from `packages/db`, not
`metadata.create_all()`, so the CHECK constraints and partial indexes are
exercised too.

## Layout

```
src/
  main.py            the five routes
  config.py          everything from the environment
  pipeline.py        one delivery, start to finish
  leases.py          claim · renew · complete · fail · release
  outbox.py          enqueue · relay · give up
  sweep.py           reclaim · give up · resume · relay
  failures.py        the closed class list, and the only place it becomes text
  shapes.py          the shape hash, shared by apply-to-all and merge
  storage.py         GCS, or a directory on disk
  publisher.py       Pub/Sub, or in-process
  health.py          /health · /readyz · /healthz
  models.py          Core tables, mirroring packages/db — never owning it
  processors/
    inspect.py       ← replaced by real schema inference
    convert.py       ← replaced by the extraction engine
```

**Only the two files in `processors/` are replaced in the next phase.**
Everything else is infrastructure and must survive that replacement untouched.

## Things worth knowing before changing this

**The claim is one statement.** Two concurrent deliveries cannot both win
because PostgreSQL serialises the row update and exactly one gets a row back.
Do not split it into a SELECT and an UPDATE.

**An unprocessable message is acked (200), not nacked.** Nacking a message
that can never succeed only burns redeliveries until the dead-letter policy
fires. The one case that nacks (409) is a live lease, because retrying later
genuinely might work.

**The lease must be longer than the work, and the ack deadline at least as
long as the lease.** Otherwise a worker that is perfectly healthy has its file
stolen mid-run. `LEASE_SECONDS` defaults to 600, which is the Pub/Sub maximum.

**The sweep is not optional.** It is the only recovery path for a failed
publish, a dead worker's lease, and a request parked on a limit. None of those
produce a message of their own.

**Some classes are not failures.** `provider_quota_exhausted` and
`budget_exceeded` pause the request with a resume time and the sweep picks it
back up; they never mark a file FAILED. `failures.py` decides which, via
`pauses_request()`, so adding one later is a change in one place. A system that
renders its normal state as an error teaches people to ignore errors.

**The failure list lives in four files and is tested.** `failures.py`, the
Prisma enum, the migration's `CREATE TYPE`, and the frontend's `types.ts` /
`http.ts`. `tests/test_contract_drift.py` reads the other three and compares —
it needs no database and no Node, so it fails fast and everywhere. That test
exists because the two halves already drifted once: only nine of twenty-one
values agreed.

**Prisma owns the schema.** This package reads and writes; it never migrates
and never autogenerates. `metadata.create_all()` is deliberately never called.
