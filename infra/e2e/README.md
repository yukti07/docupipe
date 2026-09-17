# End-to-end flow, against real infrastructure

Two scripts, for two different questions.

| Script | Answers |
|---|---|
| `db-flow.mjs` | *Does the pipeline work?* Writes the rows the backend writes, publishes the real message, polls the real tables. No app needed |
| `e2e-flow.mjs` | *Does the deployed app drive it?* Goes through the Next.js API over HTTP |

```bash
node infra/e2e/db-flow.mjs              # the pipeline, through the database
node infra/e2e/db-flow.mjs --keep       # leave the rows behind to inspect
node infra/e2e/db-flow.mjs --sweep-only # just the outbox relay, ~90s
```

`db-flow.mjs` reads the Cloud SQL credentials from `packages/web/.env.local`
and never prints them; it needs ADC with `roles/cloudsql.client`. It cleans up
after itself unless `--keep`.

---


One script. It drives the deployed backend the way the browser does, then
watches what the real Pub/Sub topics and the real Cloud Run workers do about
it. No mocks, no emulator, no fake broker.

```bash
node infra/e2e/e2e-flow.mjs --base-url https://<your-app>.vercel.app
```

Needs `gcloud` on PATH, authenticated against the project. No `npm install`.

## What it does

| Phase | Checks |
|---|---|
| 0 Preflight | Cloud Run services, their images and runtime accounts; each push subscription's endpoint **compared against the service actually deployed**; OIDC identity on the push; bucket; Cloud Scheduler job outcomes |
| 1 Backend | `/api/register` → `/api/getSignedUrl` → `PUT` the bytes to the signed URL → `/api/upload` |
| 2 GCS | the input object is really in the bucket under the key the `files` row holds |
| 2a Wire | pulls the message the backend just published off `file-uploaded-local` **without acking** and prints the decoded payload and its attributes — this is what settles any argument about the event contract |
| 3 Detection | Cloud Run logs for the push and its HTTP status, then `/api/polling/schema` until a shape arrives or it times out |
| 4 Conversion | `/api/convert`, then `/api/polling/result` until every table settles; Cloud Run logs for the processor |
| 5 DLQs | both dead-letter queues, pulled **without acking**, with each dead payload decoded |

Phase 0 alone is worth running on its own:

```bash
node infra/e2e/e2e-flow.mjs --preflight-only
```

## Options

| Flag | Default |
|---|---|
| `--base-url` | `http://localhost:3000` (or `$QUARRY_BASE_URL`) |
| `--project` | `project-cf6fd144-baf2-463b-9cd` |
| `--region` | `asia-south1` |
| `--bucket` | `zamptestbucket` |
| `--file <path>` | a generated 3-row invoice CSV |
| `--schema-timeout <s>` | 180 |
| `--result-timeout <s>` | 300 |
| `--preflight-only` | off |
| `--skip-convert` | off |
| `--verbose` | off |

## Reading a failure

- **`no POST reached this service`** — the message was never published, or the
  subscription is pushing at a different service. Phase 0 says which.
- **A worker answered `200` but no schema arrived** — the worker acked a
  message it could not act on. Pub/Sub has discarded it and there will be
  nothing in the DLQ. Check the decoded payload the DLQ prints for earlier
  runs, and the worker's own warning lines.
- **A dead message in the DLQ** — the exact bytes the worker refused, printed
  verbatim. This is the most useful artefact the run produces.
- **`DONE with 0 rows`** — `file_schema_results` was marked finished without
  any row count. The conversion did not run; something wrote the result row
  early.

Exit code is `0` when nothing failed, `1` when something did, `2` if the
script itself could not run.
