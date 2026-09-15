# Cloud backend

Stands up the deployed half of the pipeline: two Cloud Run workers (§26), the
push subscriptions that wake them, and the sweep that recovers what they drop.

The Next.js app is **not** deployed by this. It keeps running with `next dev`
and simply points at the cloud resources instead of the local ones.

## What is already provisioned

| Resource | Name |
|---|---|
| GCS bucket | `zamptestbucket` (CORS allows `http://localhost:3000`) |
| Cloud SQL | `free-trial-first-project`, us-central1, database `ZampDB` |
| Topics | `file-uploaded`, `convert-requested` (+ `-dlq` for each) |
| Artifact Registry | `asia-south1-docker.pkg.dev/<project>/zamp` |
| Images | `schema-detector` (inspect), `data-processor` (convert) |
| Service accounts | `quarry-{inspect,convert}-worker`, `quarry-{pubsub,scheduler}-invoker` |

Cloud Run runs in **asia-south1**, where the images already are. Cloud SQL is
in us-central1; the connector tunnels by instance name, so the cross-region hop
costs latency on each query and nothing else — no VPC, no IP allowlist.

## Order

The database password must be in Secret Manager before anything else — both
scripts refuse to invent one.

```sh
printf %s '<password>' | gcloud secrets versions add zampsecret --data-file=- \
  --project=project-cf6fd144-baf2-463b-9cd

./iam.sh        # who may reach what — read this one before running it
./deploy.sh     # services, subscriptions, sweep
./iam.sh        # again: the dead-letter grants need the subscriptions to exist
```

`deploy.sh` is idempotent. Every step creates or updates, so re-running after a
failure is safe.

## Pointing the web app at it

In `packages/web/.env.local`, comment out `DATABASE_URL` — it takes precedence
over everything else at `server/db/client.ts:28` — and set the four Cloud SQL
variables plus the password. `STORAGE_BACKEND=gcs` is already correct, and the
same value also routes publishing to real Pub/Sub instead of the local worker
(`server/publish.ts:72`).

## Verifying

`infra/preflight` proves connectivity and IAM against the real project rather
than against a plan:

```sh
cd ../preflight && npm install && npm run preflight
```
