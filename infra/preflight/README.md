# GCP preflight

Proves **real** connectivity and **real** IAM against a deployed project.

Detached from the application on purpose: it imports none of the app's code,
shares none of its configuration objects, and has its own dependencies. If this
script and the app disagree about whether something works, that disagreement is
the finding.

```bash
cd infra/preflight
npm install
gcloud auth application-default login

node preflight.mjs --from-terraform
```

Exit code is `0` only if nothing failed. **A skipped check is not a pass** — the
summary says so, because half the value here is refusing to claim something was
verified when it wasn't.

## Why it exists

Almost every failure in this architecture is silent:

- a service account missing token-creator **on itself** — every upload 500s, and
  the error names permissions rather than the binding
- a bucket with no CORS — `curl` uploads fine, every browser fails, and the
  browser calls it a CORS error even when it is a signature mismatch
- a dead-letter policy with no grants behind it — configured, and does nothing
- a scheduler job that was never enabled — nothing recovers, and nothing says so
- an ack deadline shorter than the lease — healthy workers lose their files

None of these produce an error anywhere until a user hits them.

## What it checks

| Group | Checks |
|---|---|
| `identity` | ADC resolves · project matches · impersonation · **signBlob works** |
| `apis` | all nine required APIs enabled |
| `storage` | bucket exists · not public · **CORS with PUT** · sign a V4 URL · **PUT through it** · read back · signed read · cleanup · **inspect worker cannot write output** |
| `sql` | password from Secret Manager · connect **through the connector** · not a superuser · connection headroom · **CREATE TABLE · CREATE TYPE · INSERT · SELECT · UPDATE · DELETE · rollback · SKIP LOCKED** · schema present · enum matches |
| `pubsub` | both topics · both DLQ topics · push config, OIDC, DLQ policy, ack deadline · **the two service-agent grants** · publish |
| `run` | both services **refuse anonymous callers** · answer authenticated · `/readyz` dependencies · `/healthz` queue state |
| `secrets` | both secrets readable (length only, never the value) |
| `scheduler` | the sweep job exists, is enabled, and carries an OIDC token |

Two of those are **negative** tests, and they matter as much as the positive
ones: a Cloud Run service that answers an authenticated call would pass just as
happily if it were open to the internet, and an inspect worker that can write
output means least privilege is a description rather than a fact.

The SQL group is the answer to "can it actually create and write tables". It
does not infer that from a grant listing — it runs the DDL and the DML, in one
transaction, and drops everything afterwards.

## Options

```
--from-terraform      read settings from `terraform output` (recommended)
--terraform-dir DIR   where to run it (default: infra/terraform)
--read-only           make no writes at all
--only a,b,c          identity, apis, storage, sql, pubsub, run, secrets, scheduler
-v, --verbose
```

`--read-only` skips exactly the checks most worth having — the ones that prove
write access. Use it when pointing at something you must not touch, and know
that a clean run means less.

## What it writes

Unless `--read-only`:

- one object under `gs://<bucket>/_preflight/` — deleted afterwards
- one message on each topic — the worker looks up a synthetic file id, doesn't
  find it, and acks with 200, which is the designed behaviour and incidentally
  proves push delivery end to end
- one table `_preflight_<timestamp>` and one enum — dropped afterwards, inside a
  transaction that rolls back if anything raises

It never prints a secret. The database password is read from Secret Manager and
used; the report shows its length and nothing else.

## Without Terraform

```bash
export GCP_PROJECT_ID=...            GCP_PROJECT_NUMBER=...
export GCS_BUCKET_NAME=...           GCP_SERVICE_ACCOUNT_EMAIL=...
export INSTANCE_CONNECTION_NAME=...  DB_NAME=...  DB_USER=...
export DB_PASSWORD_SECRET=...        # or DB_PASSWORD directly
export INSPECT_SERVICE_URL=...       CONVERT_SERVICE_URL=...
export GCP_INSPECT_SERVICE_ACCOUNT=... # enables the negative write test

node preflight.mjs
```

Anything unset makes its checks **skip**, not pass.

## In CI

```yaml
- run: cd infra/preflight && npm ci
- run: node infra/preflight/preflight.mjs --from-terraform
```

Worth running after every `terraform apply` and before the first deploy to a new
environment — that is exactly when these bindings are wrong and nothing says so.
