# Backend to Vercel and Cloud Run Integration Plan

## Objective

Allow the Next.js backend running on Vercel to publish schema-detection and conversion events to Pub/Sub. Pub/Sub then invokes the private Cloud Run workers through authenticated push subscriptions.

The backend should publish to Pub/Sub only. It should not call the workers directly and should not use the workers' runtime service accounts.

## Current GCP resources

Project:

```text
project-cf6fd144-baf2-463b-9cd
Project number: 29102861107
Region: asia-south1
```

Cloud SQL:

```text
Instance: free-trial-first-project
Connection: project-cf6fd144-baf2-463b-9cd:us-central1:free-trial-first-project
Database: ZampDB
```

Storage:

```text
Bucket: zamptestbucket
```

Artifact Registry images:

```text
asia-south1-docker.pkg.dev/project-cf6fd144-baf2-463b-9cd/zamp/schema-detector:<tag>
asia-south1-docker.pkg.dev/project-cf6fd144-baf2-463b-9cd/zamp/data-processor:<tag>
```

Cloud Run services:

```text
quarry-inspect-worker
URL: https://quarry-inspect-worker-29102861107.asia-south1.run.app
Runtime service account: quarry-inspect-worker@project-cf6fd144-baf2-463b-9cd.iam.gserviceaccount.com
Image role: schema-detector

quarry-convert-worker
URL: https://quarry-convert-worker-29102861107.asia-south1.run.app
Runtime service account: quarry-convert-worker@project-cf6fd144-baf2-463b-9cd.iam.gserviceaccount.com
Image role: data-processor
```

Pub/Sub:

```text
file-uploaded
convert-requested
file-uploaded-dlq
convert-requested-dlq

quarry-file-uploaded-push -> quarry-inspect-worker
quarry-convert-requested-push -> quarry-convert-worker
```

## Identity model

There are three separate identity responsibilities.

### 1. Vercel backend publisher identity

Create or identify a dedicated service account, for example:

```text
quarry-backend-publisher@project-cf6fd144-baf2-463b-9cd.iam.gserviceaccount.com
```

Grant it only:

```text
roles/pubsub.publisher on file-uploaded
roles/pubsub.publisher on convert-requested
```

Do not grant this account Cloud Run Admin, Cloud Run Invoker, Secret Manager access, Cloud SQL access, or Artifact Registry access.

The Vercel application should obtain short-lived Google credentials through Workload Identity Federation or the existing approved Vercel-to-Google identity mechanism. Prefer federation and service-account impersonation over a downloaded JSON key.

The external Vercel principal needs:

```text
roles/iam.serviceAccountTokenCreator
on quarry-backend-publisher@project-cf6fd144-baf2-463b-9cd.iam.gserviceaccount.com
```

Only the Vercel workload identity principal should receive that impersonation grant. Do not grant Token Creator to all users or all authenticated principals.

### 2. Pub/Sub push identity

Existing service account:

```text
quarry-pubsub-invoker@project-cf6fd144-baf2-463b-9cd.iam.gserviceaccount.com
```

It is configured as the OIDC identity on both push subscriptions. It needs:

```text
roles/run.invoker on quarry-inspect-worker
roles/run.invoker on quarry-convert-worker
```

The Google-managed Pub/Sub service agent is:

```text
service-29102861107@gcp-sa-pubsub.iam.gserviceaccount.com
```

It needs:

```text
roles/iam.serviceAccountTokenCreator on quarry-pubsub-invoker
roles/pubsub.publisher on file-uploaded-dlq and convert-requested-dlq
roles/pubsub.subscriber on quarry-file-uploaded-push and quarry-convert-requested-push
```

### 3. Cloud Run runtime identities

The services run as:

```text
quarry-inspect-worker@project-cf6fd144-baf2-463b-9cd.iam.gserviceaccount.com
quarry-convert-worker@project-cf6fd144-baf2-463b-9cd.iam.gserviceaccount.com
```

Each runtime account needs:

```text
roles/storage.objectUser on gs://zamptestbucket
roles/secretmanager.secretAccessor on zamp-database-url
roles/secretmanager.secretAccessor on zampsecret, if DB_PASSWORD is retained
roles/cloudsql.client on the project
roles/logging.logWriter on the project
```

The runtime service account is the Cloud Run `--service-account` / `serviceAccountName` value. This is the "run as" identity for the worker container. The Vercel backend must not impersonate this account for normal event publishing.

## Event contracts

### Schema detection

Publish this JSON message to `file-uploaded`:

```json
{
  "eventType": "SCHEMA_DETECTION_REQUESTED",
  "requestId": "req_e2emu2wtxxp",
  "fileId": "file_PcMpSbiqMck"
}
```

The worker obtains `bucket`, `object_key`, MIME type, and file metadata from the `files` table. Do not put a GCS path in the event.

### Conversion

The backend must first have an approved schema version and a pending processing run. Publish this JSON message to `convert-requested`:

```json
{
  "eventType": "PROCESSING_REQUESTED",
  "requestId": "req_e2emu2wtxxp",
  "fileId": "file_PcMpSbiqMck",
  "processingRunId": "run_123",
  "fileSchemaVersionId": "approved-schema-version-id"
}
```

The Pub/Sub client library accepts the raw JSON message; it performs the base64 encoding required by the push envelope.

## Backend transaction flow

1. Create or confirm the `requests` row and its `user_id`.
2. Upload the file to `gs://zamptestbucket/...` using the existing Vercel GCS integration.
3. Create/update the `files` row with the exact bucket, object key, detected MIME type, non-null size, request ID, and user ID.
4. Publish `SCHEMA_DETECTION_REQUESTED` to `file-uploaded` using an outbox row or an equivalent retry-safe transaction pattern.
5. Wait for `file_schema_versions` with the matching `request_id` and `file_id`.
6. Let the user review/edit the schema. Approval must create an immutable `APPROVED` version; do not mutate the detected version.
7. Create `processing_runs` with the approved schema version ID and status `PENDING`.
8. Publish `PROCESSING_REQUESTED` to `convert-requested` only after the processing-run row commits.
9. Read processing status and output from `processing_runs`, `structured_records`, `record_errors`, and the summary artifact.

The event and database writes must be idempotent. Pub/Sub may redeliver a message.

## Verification checklist for the backend agent

Run these checks before changing infrastructure:

```powershell
$project = "project-cf6fd144-baf2-463b-9cd"
$region = "asia-south1"

# Topics and subscriptions
gcloud pubsub topics describe file-uploaded --project=$project
gcloud pubsub topics describe convert-requested --project=$project
gcloud pubsub subscriptions describe quarry-file-uploaded-push --project=$project
gcloud pubsub subscriptions describe quarry-convert-requested-push --project=$project

# Push endpoints and OIDC identity
gcloud pubsub subscriptions describe quarry-file-uploaded-push --project=$project --format="yaml(pushConfig)"
gcloud pubsub subscriptions describe quarry-convert-requested-push --project=$project --format="yaml(pushConfig)"

# Cloud Run service identity and URL
gcloud run services describe quarry-inspect-worker --region=$region --project=$project --format="yaml(status.url,spec.template.spec.serviceAccountName)"
gcloud run services describe quarry-convert-worker --region=$region --project=$project --format="yaml(status.url,spec.template.spec.serviceAccountName)"

# Publisher IAM
gcloud pubsub topics get-iam-policy file-uploaded --project=$project
gcloud pubsub topics get-iam-policy convert-requested --project=$project
```

Confirm that:

- The Vercel publisher account is present on both topic policies with `roles/pubsub.publisher`.
- The push OIDC account is `quarry-pubsub-invoker`.
- The push endpoints are the current `quarry-inspect-worker` and `quarry-convert-worker` URLs in `asia-south1`.
- The Cloud Run runtime accounts are the two `quarry-*worker` accounts above.
- Vercel is not using a Cloud Run runtime account.

## Vercel runtime configuration

Store these as Vercel server-side environment variables, never `NEXT_PUBLIC_*` values:

```text
GOOGLE_CLOUD_PROJECT=project-cf6fd144-baf2-463b-9cd
PUBSUB_SCHEMA_TOPIC=file-uploaded
PUBSUB_CONVERT_TOPIC=convert-requested
GOOGLE_BACKEND_PUBLISHER_SERVICE_ACCOUNT=quarry-backend-publisher@project-cf6fd144-baf2-463b-9cd.iam.gserviceaccount.com
```

Use the Google Cloud Pub/Sub client library from server-only Next.js code. Publish through the impersonated publisher identity and log the Pub/Sub message ID together with request ID, file ID, and processing run ID.

Never expose service-account private keys, access tokens, Secret Manager values, database URLs, or Cloud Run invoker credentials to browser code.

## Test sequence

1. Upload a small CSV to the configured bucket.
2. Confirm its `files` row has a non-null bucket, object key, content type, and size.
3. Publish the schema event with the exact request/file IDs.
4. Verify the detector receives a 2xx push response and writes `file_schema_versions`.
5. Approve the schema and create a `PENDING` processing run.
6. Publish the conversion event.
7. Verify the processor receives a 2xx push response and the run reaches `COMPLETED` or `FAILED` with an explicit error code.
8. Verify the output summary exists under `uploads/<requestId>/processing/<runId>/summary.json`.

## Known production compatibility requirement

The production `files.stage` column is PostgreSQL enum `file_stage`, with values:

```text
UPLOADING, UPLOADED, INSPECTING, SCHEMA_READY, CONVERTING, COMPLETED, FAILED
```

The shared worker SQLAlchemy model must map this column to the existing enum rather than a generic `VARCHAR`. Deploy the updated shared package in both worker images before testing conversion.
