# Backend Infrastructure Execution Plan

## Next.js on Vercel + Google Cloud Storage + Cloud SQL PostgreSQL + Pub/Sub + Python Cloud Run Worker

**Status:** Ready for execution by a coding agent\
**Scope:** Core backend infrastructure and end-to-end processing
pipeline only\
**Out of scope:** Document extraction/intelligence implementation,
Gemini, OCR, schema inference, canonical document logic, PDF/XLSX/CSV
semantic processing, Whisper, and other domain-specific processors.

------------------------------------------------------------------------

# 1. Objective

Build a complete working backend foundation around the existing Next.js
frontend.

At the end of this implementation, this exact flow must work:

``` text
Browser
   |
   | POST /api/uploads/init
   v
Next.js API on Vercel
   |
   | generate signed upload URL
   v
Browser
   |
   | direct PUT file bytes
   v
Google Cloud Storage
   |
   | upload complete
   v
Browser
   |
   | POST /api/jobs
   v
Next.js API on Vercel
   |
   | create PostgreSQL job
   | publish Pub/Sub message
   v
Google Pub/Sub
   |
   | authenticated push
   v
Python Cloud Run Worker
   |
   | read job
   | fetch input from GCS
   | write output to GCS
   v
Google Cloud Storage

output/result.txt:

Successfully processed <GCS file name>
```

The worker is intentionally trivial in this phase.

The purpose of this phase is to prove that:

-   the Next.js backend works;
-   the browser can upload directly to GCS;
-   PostgreSQL persists job metadata;
-   Next.js can publish a job to Pub/Sub;
-   Pub/Sub can securely invoke Cloud Run;
-   Cloud Run can access PostgreSQL;
-   Cloud Run can access GCS;
-   Cloud Run can write an output artifact;
-   the frontend can retrieve job status;
-   the complete system can be deployed and reproduced.

------------------------------------------------------------------------

# 2. Important Architectural Decision

## Cloud Run Service, not Cloud Run Job

Use a **Cloud Run Service** for the worker.

The desired architecture is:

``` text
Pub/Sub
   |
   | HTTP push
   v
Cloud Run Service
```

Do not use Cloud Run Jobs for the Pub/Sub execution path in this phase.

A Cloud Run Service is appropriate because Pub/Sub can invoke it through
an authenticated HTTP push subscription, and Cloud Run handles
starting/scaling container instances.

The Python worker will later become the actual extraction engine. The
Cloud Run service/container boundary should therefore remain stable
while the Python internals evolve.

## A second entry point: the scheduled sweep

The same Cloud Run service also accepts `POST /internal/sweep`, invoked
by Cloud Scheduler on a one-minute interval (§24.3).

``` text
Pub/Sub            ->  POST /                 fast path, per job
Cloud Scheduler    ->  POST /internal/sweep   recovery path, on a timer
```

Two triggers, one service, one container. The push path carries the
normal case; the timer path is what makes the system self-healing when
the push path does not fire — a publish that failed, or a worker that
died holding a job. **Neither path is optional**, and the timer path is
the one that is easy to postpone and expensive to add later.

------------------------------------------------------------------------

# 3. Existing Repository

The repository already contains a Next.js frontend:

``` text
/
├── packages/
│   └── web/
│       └── <existing Next.js application>
│
└── ...
```

The coding agent MUST inspect the repository before modifying it.

Determine:

-   package manager;
-   Node.js version;
-   Next.js version;
-   App Router vs Pages Router;
-   TypeScript configuration;
-   existing environment-variable conventions;
-   existing linting;
-   existing testing;
-   existing monorepo tooling;
-   existing database libraries;
-   existing authentication;
-   existing deployment configuration;
-   existing API conventions.

Do not replace existing tooling unnecessarily.

Do not migrate package managers.

Do not restructure the existing frontend unless required.

Do not overwrite existing application configuration without
understanding it.

------------------------------------------------------------------------

# 4. Technology Stack

## Frontend / API

-   Next.js
-   TypeScript
-   Node.js
-   Vercel

The exact versions MUST be determined from the existing repository.

## Database

-   PostgreSQL
-   Google Cloud SQL for PostgreSQL
-   Prisma ORM unless the repository already has an established
    ORM/database layer that should be retained

## Object storage

-   Google Cloud Storage

## Queue

-   Google Cloud Pub/Sub

## Worker

-   Python
-   Cloud Run
-   Docker

## Container registry

-   Google Artifact Registry

## Infrastructure

-   Terraform
-   Google Cloud Scheduler (the recovery trigger — §24.3, §31.2)
-   Google Cloud Monitoring (alert policies — §40.5)

## Authentication / IAM

-   Google Cloud IAM
-   Vercel OIDC
-   Google Workload Identity Federation

Avoid long-lived Google service-account JSON keys wherever possible.

## Secrets

-   Google Secret Manager where secrets are genuinely required
-   Vercel environment variables for application configuration
-   Prefer OIDC/federated short-lived credentials instead of static GCP
    credentials

------------------------------------------------------------------------

# 5. Google Cloud Region

Use:

``` text
asia-south1
```

Mumbai.

Define this once in Terraform/configuration.

Do not hard-code `asia-south1` throughout application code.

------------------------------------------------------------------------

# 6. Human Admin Responsibilities

This section is intentionally explicit.

The coding agent must NOT ask the human to paste credentials, private
keys, passwords, or API secrets into the chat.

The human administrator is responsible for performing or approving the
following actions.

## 6.1 Create/select Google Cloud project

The human must provide the coding environment/agent with the following
NON-SECRET configuration:

``` text
GCP_PROJECT_ID
GCP_PROJECT_NUMBER
GCP_REGION=asia-south1
```

The project must have billing enabled if required by Google Cloud for
the selected resources.

Do not provide a service-account private key to the coding agent.

------------------------------------------------------------------------

## 6.2 Enable required Google Cloud APIs

Terraform should enable required APIs where possible.

At minimum expect:

``` text
storage.googleapis.com
pubsub.googleapis.com
run.googleapis.com
artifactregistry.googleapis.com
sqladmin.googleapis.com
iam.googleapis.com
iamcredentials.googleapis.com
sts.googleapis.com
cloudresourcemanager.googleapis.com
secretmanager.googleapis.com
```

If Terraform requires additional APIs, add them to the infrastructure
module.

------------------------------------------------------------------------

## 6.3 Human authentication to Google Cloud

For local infrastructure provisioning, the human administrator should
authenticate using the normal Google Cloud
CLI/application-default-credentials mechanism.

Example:

``` bash
gcloud auth login
gcloud auth application-default login
gcloud config set project <GCP_PROJECT_ID>
```

Do not create or commit a service-account JSON file solely to make local
development convenient.

------------------------------------------------------------------------

## 6.4 Human approval for billing/IAM

The human administrator must approve:

-   enabling billing;
-   creation of Cloud SQL;
-   creation of Cloud Run;
-   creation of Pub/Sub;
-   creation of GCS buckets;
-   creation of service accounts;
-   granting IAM permissions;
-   creation of Workload Identity Federation resources;
-   deployment to the GCP project.

The coding agent may prepare Terraform for these actions but must not
silently broaden permissions.

------------------------------------------------------------------------

## 6.5 Vercel configuration

The human administrator must connect the Vercel project to the intended
repository/project.

The following configuration may need to be entered into Vercel
environment variables after Terraform creates the corresponding
resources:

``` text
GCP_PROJECT_ID
GCP_PROJECT_NUMBER
GCP_REGION
GCS_BUCKET_NAME
PUBSUB_TOPIC_NAME
GCP_SERVICE_ACCOUNT_EMAIL
GCP_WORKLOAD_IDENTITY_POOL_ID
GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID
```

These are configuration identifiers, not private credentials.

------------------------------------------------------------------------

## 6.6 No static Google private keys

Do NOT create a configuration such as:

``` text
GOOGLE_APPLICATION_CREDENTIALS=<base64 service account JSON>
```

for the Vercel application.

Do not commit:

``` text
service-account.json
credentials.json
*.key.json
```

or equivalent.

Vercel should authenticate to Google Cloud using OIDC + Workload
Identity Federation.

------------------------------------------------------------------------

## 6.7 Secrets

If a genuine application secret is required, the human administrator
must create/store it in the approved secret-management system.

Never request that the human paste the secret into the coding-agent
conversation.

The agent should provide:

1.  the secret name;
2.  why it is needed;
3.  where it must be configured;
4.  which service account needs access.

------------------------------------------------------------------------

# 7. Infrastructure Resources

Terraform must create/manage the following.

``` text
GCP Project
|
├── GCS bucket
│   └── CORS configuration (see §9.1)
|
├── Cloud SQL PostgreSQL instance
│   └── PostgreSQL database
|
├── Pub/Sub topic
│
├── Pub/Sub push subscription
│   └── dead-letter policy
│
├── Pub/Sub dead-letter topic
│
├── Pub/Sub dead-letter subscription (pull, for inspection)
│
├── Artifact Registry Docker repository
│
├── Cloud Run service
│
├── Cloud Scheduler job  →  POST /internal/sweep   (see §24.3)
│
├── Vercel service account
│
├── Cloud Run worker service account
│
├── Pub/Sub invoker service account
│
├── Scheduler invoker service account
│
└── Workload Identity Federation resources
```

The Cloud Scheduler job is **not optional**. It is the only thing that
recovers an outbox row whose inline publish failed (§24) and the only
thing that recovers a job whose worker died mid-processing (§31.2).
Without it, both failure modes wait for a coincidence.

------------------------------------------------------------------------

# 8. Recommended Terraform Structure

Create:

``` text
infra/
└── terraform/
    ├── versions.tf
    ├── providers.tf
    ├── variables.tf
    ├── outputs.tf
    ├── main.tf
    ├── apis.tf
    ├── storage.tf
    ├── database.tf
    ├── pubsub.tf
    ├── artifact-registry.tf
    ├── service-accounts.tf
    ├── iam.tf
    ├── workload-identity.tf
    ├── cloud-run.tf
    ├── scheduler.tf
    └── monitoring.tf
```

If the repository already has an infrastructure convention, adapt to it
rather than creating a conflicting structure.

------------------------------------------------------------------------

# 9. GCS Bucket

Create one environment-specific bucket.

Example:

``` text
structured-data-dev-<unique-suffix>
```

The bucket name must be globally unique.

Object layout:

``` text
uploads/
  <jobId>/
    input/
      <safe-filename>

    output/
      result.txt
```

Example:

``` text
uploads/
  job_01KABC/
    input/
      hello.txt
    output/
      result.txt
```

The bucket must NOT be publicly writable.

The application must not expose a public bucket.

------------------------------------------------------------------------

## 9.1 Bucket CORS — required for browser upload

A browser cannot `PUT` to another origin unless that origin says it is
allowed. Before the real `PUT`, the browser sends an `OPTIONS` preflight
to GCS. GCS answers that preflight from the **bucket's CORS
configuration**, not from the signed URL. A bucket with no CORS
configuration fails every browser upload while `curl` succeeds — so
**Test Module 3 must be run from a browser, not only from `curl`.**

Terraform must set CORS on the bucket:

``` hcl
resource "google_storage_bucket" "uploads" {
  name                        = var.bucket_name
  location                    = var.region
  uniform_bucket_level_access = true

  cors {
    origin          = var.cors_origins
    method          = ["PUT", "GET", "HEAD", "OPTIONS"]
    response_header = ["Content-Type", "Content-Length", "ETag", "x-goog-generation"]
    max_age_seconds = 3600
  }
}
```

`cors_origins` per environment:

``` text
dev      ["*"]
prod     ["https://<production-domain>", "http://localhost:3000"]
```

Three rules that decide whether this works:

1.  **GCS matches `origin` as an exact string, or `*`. There are no
    partial wildcards.** `https://*.vercel.app` does not work. Vercel
    preview deployments each get a distinct hostname, so either list
    `"*"` on the dev bucket or accept that previews cannot upload.
2.  **`*` is acceptable here.** CORS is not the security boundary — the
    **signed URL is**. An origin that is allowed by CORS still cannot
    write anything without a valid, unexpired, server-issued signature.
    Do not weaken the signature to compensate for a narrow CORS list, and
    do not assume a narrow CORS list is protecting the bucket.
3.  **The `Content-Type` the browser sends must be byte-identical to the
    one signed into the URL.** If `/api/uploads/init` signs
    `text/plain` and the browser sends `text/plain;charset=utf-8`, GCS
    returns `403 SignatureDoesNotMatch`. Because the response carries no
    CORS headers, the browser reports it as a **CORS error**, which sends
    people to fix the wrong thing. The frontend must send exactly the
    `headers` object returned by `/api/uploads/init` (§18) and must not
    let `fetch`/`XMLHttpRequest` infer a Content-Type of its own.

Applying CORS is a bucket metadata update and takes effect immediately;
it does not require recreating the bucket.

------------------------------------------------------------------------

# 10. Upload Security

The browser receives a short-lived signed URL from Next.js.

The browser uploads directly to GCS.

Correct:

``` text
Browser
   |
   | signed PUT
   v
GCS
```

Incorrect:

``` text
Browser
   |
   | file bytes
   v
Vercel
   |
   v
GCS
```

The Next.js application must never proxy the actual file bytes.

------------------------------------------------------------------------

# 11. PostgreSQL

Create a Cloud SQL PostgreSQL instance.

Use a database such as:

``` text
structured_data
```

Create an application database user with only the permissions required
by the application.

Do not use the PostgreSQL superuser from application code.

------------------------------------------------------------------------

# 12. Database Schema

For this phase, create the following core tables.

## users

``` text
id
email
created_at
updated_at
```

If authentication is already implemented in the existing application,
integrate with the existing user identity rather than creating a second
authentication system.

------------------------------------------------------------------------

## files

``` text
id
user_id

original_filename
content_type
size_bytes

bucket
object_key
generation
checksum

status

created_at
uploaded_at
deleted_at
```

File status:

``` text
PENDING_UPLOAD
UPLOADED
FAILED
DELETED
```

------------------------------------------------------------------------

## jobs

``` text
id
user_id

status

attempts
max_attempts
claimed_by
claimed_until

created_at
started_at
completed_at
updated_at

error_code
error_message
```

Initial job statuses:

``` text
QUEUED
PROCESSING
COMPLETED
FAILED
```

Do not implement the full future extraction state machine yet.

### Lease columns

`claimed_by` and `claimed_until` are a **lease**, and they are the whole
of §31.2. A worker takes a job by writing its own instance id into
`claimed_by` and a future timestamp into `claimed_until`. A worker that
dies without releasing the claim has the job reclaimed when the lease
expires — crash recovery with no extra machinery and no second system.

``` text
attempts        incremented on every successful claim
max_attempts    default 5; when attempts reaches it, the job is failed
                terminally rather than re-queued
claimed_by      Cloud Run instance id, or any stable per-process id
claimed_until   NULL unless the job is actively claimed
```

Index: `(status, claimed_until)` — the reaper's only query.

------------------------------------------------------------------------

------------------------------------------------------------------------

## job_files

``` text
job_id
file_id
role
```

For this phase:

``` text
role = INPUT
```

Keep the relationship table because future jobs may have multiple input
files.

------------------------------------------------------------------------

## job_events

``` text
id
job_id
event_type
message
metadata
created_at
```

At minimum create events for:

``` text
JOB_CREATED
JOB_QUEUED
PROCESSING_STARTED
FILE_FETCHED
OUTPUT_WRITTEN
JOB_COMPLETED
JOB_FAILED
```

This will make debugging significantly easier.

------------------------------------------------------------------------

## job_outbox

The transactional outbox. This table is what makes job creation atomic
(§24). It is written **in the same PostgreSQL transaction as the job**,
and it is the authoritative record that a job still needs to reach
Pub/Sub.

``` text
id
job_id
topic
payload          jsonb  -- { "jobId": "..." }
status           PENDING | PUBLISHED | DEAD
attempts
next_attempt_at
last_error
published_at
created_at
updated_at
```

Index: `(status, next_attempt_at)` — the relay's only query.

A row is `PENDING` from the moment the job is created until Pub/Sub has
accepted the message. Nothing outside this table decides whether a job
was queued.

------------------------------------------------------------------------

# 13. Database Ownership

PostgreSQL stores:

``` text
metadata
job state
file references
processing events
```

GCS stores:

``` text
actual uploaded files
actual generated artifacts
```

Never store large file contents in PostgreSQL.

------------------------------------------------------------------------

# 14. Next.js Backend Structure

Use the existing Next.js App Router structure.

Expected API paths:

``` text
packages/web/app/api/uploads/init/route.ts

packages/web/app/api/jobs/route.ts

packages/web/app/api/jobs/[jobId]/route.ts
```

The exact location can be adapted if the existing project uses a
different structure.

------------------------------------------------------------------------

# 15. Backend Service Layer

Do not place all logic inside Route Handlers.

Use modules similar to:

``` text
packages/web/
└── src/
    └── server/
        ├── gcp/
        │   ├── auth.ts
        │   ├── storage.ts
        │   └── pubsub.ts
        │
        ├── db/
        │   ├── client.ts
        │   ├── repositories/
        │   │   ├── files.ts
        │   │   ├── jobs.ts
        │   │   └── events.ts
        │   └── ...
        │
        ├── uploads/
        │   ├── upload-service.ts
        │   └── schemas.ts
        │
        └── jobs/
            ├── job-service.ts
            └── schemas.ts
```

Adapt to existing repository conventions.

------------------------------------------------------------------------

# 16. API: POST /api/uploads/init

## Purpose

Initialize a browser-to-GCS upload.

## Request

``` json
{
  "filename": "hello.txt",
  "contentType": "text/plain",
  "size": 100
}
```

## Validate

-   filename exists;
-   filename is non-empty;
-   filename is within configured length;
-   content type exists;
-   content type is allowed;
-   size is positive;
-   size is below configured maximum.

Do not trust the file extension.

------------------------------------------------------------------------

# 17. Upload Object Key

The backend must generate the storage path.

Do not allow the client to select an arbitrary GCS object key.

Recommended flow:

``` text
generate uploadId
      |
      v
create pending file record
      |
      v
uploads/<uploadId>/input/<safe-filename>
```

The actual job ID can later become part of the canonical storage path if
desired.

For this phase, an upload ID/file ID can be used before job creation.

------------------------------------------------------------------------

# 18. Upload API Response

Return something similar to:

``` json
{
  "fileId": "file_123",
  "objectKey": "uploads/file_123/input/hello.txt",
  "upload": {
    "method": "PUT",
    "url": "<signed-url>",
    "headers": {
      "Content-Type": "text/plain"
    }
  }
}
```

Never return private GCP credentials.

------------------------------------------------------------------------

# 19. Browser Upload

The frontend must execute:

``` text
POST /api/uploads/init
        |
        v
signed URL
        |
        v
PUT file directly to GCS
        |
        v
upload succeeds
```

Only after the GCS upload succeeds should the frontend create a job.

------------------------------------------------------------------------

# 20. Upload Verification

When creating a job, the backend should verify the referenced file
belongs to the authenticated user.

It should also verify that the corresponding GCS object exists.

The database file status should then become:

``` text
UPLOADED
```

Do not mark an upload as successfully uploaded merely because
`/api/uploads/init` returned successfully.

------------------------------------------------------------------------

# 21. API: POST /api/jobs

## Purpose

Create and queue a processing job.

Request:

``` json
{
  "fileId": "file_123"
}
```

The client must not provide the authoritative bucket/object path.

The server resolves it from the database.

------------------------------------------------------------------------

# 22. Job Creation Flow

Everything that must agree happens inside **one PostgreSQL
transaction**. Pub/Sub is contacted only *after* that transaction has
committed, and the commit is what makes the job queued — not the
publish.

``` text
authenticate
    |
    v
validate request
    |
    v
load file record
    |
    v
verify file ownership
    |
    v
verify GCS object exists          <- outside the transaction; a network
    |                                call must not hold a DB transaction
    v
+---------------- BEGIN -------------------+
|                                          |
|  create job            status = QUEUED   |
|  create job_files                        |
|  create JOB_CREATED event                |
|  create JOB_QUEUED event                 |
|  create job_outbox row status = PENDING  |
|                                          |
+---------------- COMMIT ------------------+
    |
    v
return job ID to the client        <- the API is done here; it does not
    |                                 wait on Pub/Sub
    v
best-effort inline publish (§24.2)
```

The job is created as `QUEUED`, not as some pre-queued status, because
the committed outbox row **is** the queue entry. There is no window in
which a job is durably created but not durably queued.

The API responds as soon as the transaction commits. The inline publish
in §24.2 is a latency optimisation, not a correctness requirement, and
its failure is not reported to the client.

------------------------------------------------------------------------

# 23. Pub/Sub Message

Use a small metadata-only message.

For this infrastructure phase:

``` json
{
  "jobId": "job_123"
}
```

The worker will retrieve all authoritative file information from
PostgreSQL.

Do not put file bytes into Pub/Sub.

Do not put the full file contents into PostgreSQL.

------------------------------------------------------------------------

# 24. Database / Pub/Sub Consistency — the transactional outbox

## 24.1 The problem being solved

Writing to PostgreSQL and publishing to Pub/Sub are two systems and
cannot be committed together. A naive sequence has two failure windows,
and the second one is the dangerous half:

``` text
create job  ->  publish  ->  mark QUEUED

            ^             ^
            |             |
    publish never     publish SUCCEEDED and the process died.
    happened:         The worker is already processing a job whose
    job is orphaned   row does not say it was queued.
```

Marking the job `FAILED` on a publish error, as earlier drafts of this
plan did, is also wrong: a transient Pub/Sub error is retryable, and
failing the job terminally throws away work the user asked for with no
route back.

**Implement the outbox now.** It is one table, one relay endpoint and one
scheduled trigger. Retrofitting it after the extraction engine lands is
significantly more expensive, because by then the job row has real work
attached to it.

## 24.2 Write path

``` text
+------------- one transaction -------------+
|  INSERT jobs         (status = QUEUED)    |
|  INSERT job_files                         |
|  INSERT job_events   (JOB_CREATED,        |
|                       JOB_QUEUED)         |
|  INSERT job_outbox   (status = PENDING,   |
|                       next_attempt_at =   |
|                       now())              |
+------------------- COMMIT ----------------+
                    |
                    v
        try to publish immediately
        (fast path, best effort)
                    |
        +-----------+-----------+
        |                       |
     success                 failure
        |                       |
        v                       v
  UPDATE job_outbox        leave row PENDING.
  SET status=PUBLISHED,    Log at WARN. Do NOT
      published_at=now()   fail the API response.
```

The inline publish exists so the common case has no scheduler latency.
If it throws, is slow, or the process is killed mid-call, **nothing is
lost** — the `PENDING` row is committed and the relay will pick it up.

At-least-once publishing is the accepted consequence: the inline attempt
may succeed and its acknowledgement may be lost, so the relay publishes
again. §31 makes duplicate delivery harmless.

## 24.3 The relay

A single internal endpoint on the worker, driven by Cloud Scheduler:

``` text
Cloud Scheduler  (every 1 minute, OIDC-authenticated)
        |
        v
POST /internal/sweep   on the Cloud Run worker
        |
        +--> 24.3a  publish PENDING outbox rows
        |
        +--> 31.2   reclaim jobs with expired leases
```

Claiming outbox rows:

``` sql
UPDATE job_outbox
   SET status          = 'PENDING',
       attempts        = attempts + 1,
       next_attempt_at = now() + (interval '10 seconds' * power(2, attempts)),
       updated_at      = now()
 WHERE id IN (
       SELECT id
         FROM job_outbox
        WHERE status = 'PENDING'
          AND next_attempt_at <= now()
        ORDER BY created_at
        LIMIT 100
        FOR UPDATE SKIP LOCKED
 )
RETURNING *;
```

`FOR UPDATE SKIP LOCKED` is what makes the relay safe to run
concurrently — two sweeps overlapping claim disjoint rows instead of
double-publishing or blocking. Do not replace it with a status flag and
a `SELECT` followed by an `UPDATE`; that has a race in it.

For each claimed row: publish, then

``` text
success  ->  status = PUBLISHED, published_at = now()
failure  ->  status stays PENDING, last_error set,
             next_attempt_at already backed off above
```

When `attempts >= 10`:

``` text
job_outbox.status = DEAD
jobs.status       = FAILED
jobs.error_code   = PUBSUB_PUBLISH_FAILED
job_events        <- JOB_FAILED
```

This is the **only** path by which a publish failure becomes a failed
job, and it happens after roughly three hours of retries rather than on
the first error.

## 24.4 Alerting

A `PENDING` outbox row older than five minutes means the relay is not
running. Surface it through the health endpoint (§40) and alert on it.
A silent outbox is indistinguishable from a working one until a user
notices their job never started.

------------------------------------------------------------------------

# 25. API: GET /api/jobs/:jobId

Purpose:

``` text
frontend polling
```

Return:

``` json
{
  "id": "job_123",
  "status": "PROCESSING",
  "createdAt": "...",
  "updatedAt": "...",
  "completedAt": null,
  "error": null
}
```

If completed:

``` json
{
  "id": "job_123",
  "status": "COMPLETED",
  "result": {
    "bucket": "...",
    "objectKey": "uploads/job_123/output/result.txt"
  }
}
```

The API must verify job ownership.

------------------------------------------------------------------------

# 26. Cloud Run Worker Repository

Create a separate Python worker package.

Recommended:

``` text
packages/
├── web/
│
└── worker/
    ├── src/
    │   ├── main.py
    │   ├── config.py
    │   ├── pubsub_handler.py
    │   ├── models.py
    │   ├── database.py
    │   ├── gcs.py
    │   ├── leases.py        # claim, renew, release  (§31.1)
    │   ├── outbox.py        # relay                  (§24.3)
    │   ├── sweep.py         # POST /internal/sweep   (§24.3 + §31.2)
    │   ├── health.py        # /health /readyz /healthz (§40)
    │   └── processor.py
    │
    ├── tests/
    │   ├── test_pubsub_handler.py
    │   ├── test_leases.py
    │   ├── test_outbox.py
    │   ├── test_sweep.py
    │   └── test_processor.py
    │
    ├── requirements.txt
    ├── Dockerfile
    └── README.md
```

`processor.py` is the only module the next phase replaces. Everything
else — leasing, outbox, sweep, health — is infrastructure and must
survive that replacement untouched.

Adapt if the repository already has a Python workspace convention.

------------------------------------------------------------------------

# 27. Worker Technology

Use:

``` text
Python
FastAPI
Uvicorn
google-cloud-storage
google-cloud-pubsub
SQLAlchemy
psycopg
Pydantic
```

Use only the dependencies actually required.

The worker exposes:

``` text
POST /                    Pub/Sub push envelope      (§28)
POST /internal/sweep      Cloud Scheduler            (§24.3, §31.2)
GET  /health              liveness                   (§40.1)
GET  /readyz              readiness                  (§40.2)
GET  /healthz             queue and outbox state     (§40.3)
```

`POST /` and `POST /internal/sweep` are both IAM-protected by Cloud Run
and invoked with OIDC tokens by their respective service accounts. The
three `GET` endpoints are reachable by Cloud Run's own probes and by
anything holding `roles/run.invoker`; they expose counts only (§40).

------------------------------------------------------------------------

# 28. Worker Contract

Cloud Run receives a Pub/Sub push envelope.

The worker must:

1.  accept POST;
2.  validate the envelope;
3.  decode `message.data`;
4.  parse the JSON message;
5.  validate `jobId`;
6.  **claim the job with a conditional UPDATE** (§31.1) — this both
    loads it and marks it `PROCESSING`, atomically;
7.  branch on the claim result (§31.1 table) — a job that was not
    claimable is *not* an error;
8.  fetch file metadata from PostgreSQL;
9.  fetch the GCS object;
10. write an output artifact;
11. mark the job `COMPLETED` **and clear the lease** in one statement;
12. return the HTTP status the branch in §31.1 selected.

Steps 6 and 11 are the only places job state changes. Do not write
`status = 'PROCESSING'` anywhere else.

------------------------------------------------------------------------

# 29. Worker Processing Logic

For this phase:

``` text
Pub/Sub message
      |
      v
load job
      |
      v
load job_file
      |
      v
load file record
      |
      v
read GCS object
      |
      v
extract original filename
      |
      v
create text:
"Successfully processed <filename>"
      |
      v
write result.txt to GCS
      |
      v
create OUTPUT_WRITTEN event
      |
      v
mark job COMPLETED
```

No AI or document processing is involved.

------------------------------------------------------------------------

# 30. Output Path

Recommended:

``` text
uploads/<jobId>/output/result.txt
```

Example:

``` text
uploads/job_123/output/result.txt
```

Contents must be exactly:

``` text
Successfully processed hello.txt
```

where `hello.txt` is the original GCS file name.

------------------------------------------------------------------------

# 31. Worker Idempotency, Leasing and Stuck-Job Recovery

Pub/Sub delivers at least once, and §24 publishes at least once on top
of that. Duplicate delivery is the normal case, not the edge case. A
status check alone (`if job.status == COMPLETED: return`) does not cover
the case that actually hurts: a worker that died **after** marking a job
`PROCESSING`. That job is `PROCESSING` forever, and a status check tells
the next delivery nothing useful about whether anyone is still working
on it.

The fix is a lease, and it is one conditional `UPDATE`.

## 31.1 Claiming — the only way a job enters PROCESSING

``` sql
UPDATE jobs
   SET status        = 'PROCESSING',
       claimed_by    = :instance_id,
       claimed_until = now() + :lease_duration,
       attempts      = attempts + 1,
       started_at    = COALESCE(started_at, now()),
       updated_at    = now()
 WHERE id = :job_id
   AND (
         status = 'QUEUED'
      OR (status = 'PROCESSING' AND claimed_until < now())
       )
   AND attempts < max_attempts
RETURNING *;
```

One statement, so two concurrent deliveries cannot both win: PostgreSQL
serialises the row update and exactly one of them gets a row back.

If it returns **a row**, this delivery owns the job. Process it.

If it returns **no row**, read the job and branch:

| Job state | Meaning | HTTP | Why |
|---|---|---|---|
| `COMPLETED` | Already done by an earlier delivery | **200** | Ack. Duplicate delivery, nothing to do |
| `FAILED` | Terminal | **200** | Ack. Redelivering will not change the outcome, and nacking would loop until the DLQ |
| `PROCESSING`, lease still live | Another instance is genuinely working on it | **409** | Nack. Pub/Sub backs off and redelivers; the next delivery finds it `COMPLETED`, or finds an expired lease and takes over |
| `attempts >= max_attempts` | Exhausted | **200** | Ack, and mark `FAILED` / `WORKER_MAX_ATTEMPTS` if not already |
| Not found | Unknown job id | **200** | Ack. Redelivery cannot make the row appear; log at ERROR |

Returning **200 for an unprocessable message is deliberate**. A nack on
a message that can never succeed just burns redeliveries until the
dead-letter policy fires. Nack only when retrying later could plausibly
work — which, in this table, is exactly the live-lease row.

## 31.2 Lease duration, renewal, and the reaper

``` text
lease_duration          600 seconds (phase 1)
Pub/Sub ack deadline    600 seconds  (the maximum)
Cloud Run request timeout  900 seconds  (> ack deadline)
```

The lease must be **longer than the work** and the ack deadline must be
**at least as long as the lease**, or a job whose worker is still
healthy gets stolen.

**Renewal.** For the trivial phase-1 processor a fixed 600s lease is
sufficient. The real extraction engine will exceed it, so the worker
must implement lease renewal from the start: a background task that
issues

``` sql
UPDATE jobs
   SET claimed_until = now() + :lease_duration
 WHERE id = :job_id AND claimed_by = :instance_id;
```

every `lease_duration / 3`, and stops when processing ends. The
`claimed_by` predicate means a worker that has already lost its lease
cannot take it back.

**The reaper.** A lease expiring is only useful if something notices. A
job can reach a state where no Pub/Sub message will ever be redelivered
— the message was acked before the crash, or the dead-letter policy has
already fired. The same scheduled sweep that runs the outbox relay
(§24.3) also runs:

``` sql
-- 1. reclaim: put expired-lease jobs back in the queue
UPDATE jobs
   SET status        = 'QUEUED',
       claimed_by    = NULL,
       claimed_until = NULL,
       updated_at    = now()
 WHERE status = 'PROCESSING'
   AND claimed_until < now()
   AND attempts < max_attempts
RETURNING id;
-- then INSERT a fresh job_outbox row per reclaimed id, so the relay
-- re-publishes it. Write a JOB_RECLAIMED event.

-- 2. give up: fail jobs that have burned their attempts
UPDATE jobs
   SET status      = 'FAILED',
       error_code  = 'WORKER_MAX_ATTEMPTS',
       claimed_by  = NULL,
       claimed_until = NULL,
       updated_at  = now()
 WHERE status = 'PROCESSING'
   AND claimed_until < now()
   AND attempts >= max_attempts;
-- write a JOB_FAILED event
```

The reclaim path goes back through the **outbox**, not directly to
Pub/Sub, so there is still exactly one way a job gets queued.

## 31.3 Dead-letter topic

Configure the push subscription with a dead-letter policy:

``` text
max_delivery_attempts   5
dead_letter_topic       <topic>-dlq
```

Grant the Pub/Sub service agent `roles/pubsub.publisher` on the DLQ topic
and `roles/pubsub.subscriber` on the source subscription, or the policy
silently does nothing.

Create a **pull** subscription on the DLQ for inspection. Nothing
consumes it automatically in this phase — its job is to stop a poison
message cycling forever and to leave the evidence somewhere a human can
read it. Alert on DLQ depth > 0.

## 31.4 Output writes

The output path is deterministic:

``` text
uploads/<jobId>/output/result.txt
```

Repeated processing overwrites the same object. Content is a pure
function of the job, so an overwrite is a no-op in effect. Do not create
a second output location, and do not create a second job.

------------------------------------------------------------------------

# 32. Cloud Run Service Account

Create a dedicated service account:

``` text
structured-data-<env>-worker
```

It should have only the permissions necessary for:

-   reading required GCS objects;
-   writing output objects;
-   connecting to Cloud SQL;
-   reading required secrets.

Do not grant project Owner/Editor.

------------------------------------------------------------------------

# 33. Pub/Sub Push Authentication

Create a dedicated service account for Pub/Sub invocation.

Grant:

``` text
roles/run.invoker
```

on the Cloud Run service.

Configure the Pub/Sub push subscription to use authenticated OIDC
tokens.

Cloud Run should not allow unauthenticated invocation.

------------------------------------------------------------------------

# 34. Cloud Run Configuration

Initial configuration:

``` text
service name:
structured-data-<env>-worker

region:
asia-south1

min instances:
0

max instances:
3

CPU:
1

memory:
512Mi or 1Gi

concurrency:
1

request timeout:
900s          (must exceed the Pub/Sub ack deadline)
```

`max instances: 3` rather than `1`. With `concurrency: 1`, max instances
*is* the parallelism of the whole system. At `1`, every message beyond
the first waits, and messages that wait past the 600s ack deadline are
redelivered — so a queue that is merely busy looks like a queue that is
failing. Three is enough to keep the sweep endpoint responsive while a
job is running and is still bounded for cost. Raise it when the real
engine lands.

Concurrency stays at `1`: the worker is CPU-bound and holds a database
connection per request.

## 34.1 Probes

``` text
startup probe     GET /health     initialDelay 0s, period 5s, failureThreshold 12
liveness probe    GET /health     period 30s, timeout 3s
```

Both point at `/health` (process liveness only — see §40). **Do not
point a probe at `/readyz` or `/healthz`**: those touch PostgreSQL, and
a probe that restarts the container when the database blips converts a
transient dependency failure into a restart loop.

## 34.2 Terraform vs the deployment pipeline — who owns the image

Terraform creates the Cloud Run service. The deployment pipeline pushes
new images to it. If both claim the `image` field, the next
`terraform apply` silently reverts production to whatever image is in
Terraform state.

Terraform owns the service's **shape** (service account, env vars, Cloud
SQL attachment, scaling, probes, IAM). The pipeline owns the service's
**image**. Express that:

``` hcl
resource "google_cloud_run_v2_service" "worker" {
  name     = "structured-data-${var.env}-worker"
  location = var.region

  template {
    service_account = google_service_account.worker.email
    max_instance_request_concurrency = 1
    timeout = "900s"

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    containers {
      image = var.worker_image   # placeholder on first apply
      # ...
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }
}
```

``` text
variable "worker_image" {
  default = "us-docker.pkg.dev/cloudrun/container/hello"
}
```

Notes:

-   The placeholder exists so the service can be created **before** the
    first image is built. Artifact Registry must exist first; the
    service does not have to wait for a real image.
-   `client` and `client_version` are stamped by `gcloud run deploy` and
    will otherwise show as permanent drift on every plan.
-   After Milestone 7 the pipeline deploys with
    `gcloud run deploy --image <digest>`. **Deploy by digest, not by
    tag** — a tag is a moving target and makes a rollback ambiguous.
-   Rollback is `gcloud run services update-traffic --to-revisions=...`,
    not a `terraform apply`.
-   If a future change genuinely needs Terraform to set the image, set
    `worker_image` explicitly and remove it from `ignore_changes` in the
    same commit. Do not do one without the other.

Use environment variables for configuration.

Do not hard-code project IDs, bucket names, database names, or topic
names.

------------------------------------------------------------------------

# 35. Artifact Registry

Create:

``` text
structured-data-<env>
```

Docker repository in:

``` text
asia-south1
```

Worker deployment:

``` text
Python source
    |
    v
Docker build
    |
    v
Artifact Registry
    |
    v
Cloud Run
```

------------------------------------------------------------------------

# 36. Cloud SQL Connectivity

Cloud SQL does not accept raw connections from the internet by default,
and it should not be made to. Every connection goes through the **Cloud
SQL Auth Proxy**, which authenticates with IAM and wraps the connection
in mTLS using short-lived, automatically-rotated certificates. No
database password travels the network in the clear and no IP allowlist
is required.

The proxy takes **three different forms** depending on where the client
runs. All three are the same mechanism.

``` text
Cloud Run worker  ->  proxy built into the platform   (§36.1)
Local development ->  cloud-sql-proxy binary          (§36.2)
Vercel functions  ->  connector library, in-process   (§36.3)
```

The instance connection name is the same everywhere:

``` text
<GCP_PROJECT_ID>:<GCP_REGION>:<INSTANCE_NAME>
e.g. my-project:asia-south1:structured-data-dev
```

Every one of these needs `roles/cloudsql.client` on the calling service
account. Grant nothing broader — in particular **not**
`roles/cloudsql.admin`.

------------------------------------------------------------------------

## 36.1 Cloud Run worker — the platform's built-in proxy

Cloud Run runs the proxy for you and exposes it as a Unix socket. There
is no sidecar to define.

**Steps**

1.  Grant the worker service account `roles/cloudsql.client`:

    ``` hcl
    resource "google_project_iam_member" "worker_sql_client" {
      project = var.project_id
      role    = "roles/cloudsql.client"
      member  = "serviceAccount:${google_service_account.worker.email}"
    }
    ```

2.  Attach the instance to the service and mount the socket:

    ``` hcl
    template {
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.main.connection_name]
        }
      }

      containers {
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }

        env {
          name  = "INSTANCE_CONNECTION_NAME"
          value = google_sql_database_instance.main.connection_name
        }
        env {
          name  = "DB_NAME"
          value = google_sql_database.app.name
        }
        env {
          name  = "DB_USER"
          value = google_sql_user.app.name
        }
        env {
          name = "DB_PASSWORD"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.db_password.secret_id
              version = "latest"
            }
          }
        }
      }
    }
    ```

3.  Connect over the socket, not TCP. SQLAlchemy:

    ``` python
    from sqlalchemy.engine.url import URL

    url = URL.create(
        drivername="postgresql+psycopg",
        username=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        database=os.environ["DB_NAME"],
        query={"host": f"/cloudsql/{os.environ['INSTANCE_CONNECTION_NAME']}"},
    )
    engine = create_engine(url, pool_size=2, max_overflow=0, pool_pre_ping=True)
    ```

    Note `host` goes in the **query string**, not the host field — the
    path is a socket directory, not a hostname.

4.  Keep the pool small. `concurrency: 1` × `max instances: 3` means at
    most three request-serving containers; `pool_size=2` is ample.
    `pool_pre_ping=True` matters because Cloud Run freezes idle
    instances and a resumed connection may be dead.

**Alternative:** the `cloud-sql-python-connector` library works here too
and is the better choice if the worker ever runs somewhere without the
built-in integration. The socket path is simpler and is what this plan
uses.

------------------------------------------------------------------------

## 36.2 Local development — the `cloud-sql-proxy` binary

**Steps**

1.  Install the v2 proxy:

    ``` bash
    # macOS
    brew install cloud-sql-proxy
    # or download the release binary for your platform from
    # github.com/GoogleCloudPlatform/cloud-sql-proxy/releases
    ```

2.  Authenticate once. The proxy uses Application Default Credentials:

    ``` bash
    gcloud auth application-default login
    ```

3.  Run it. It listens on localhost and forwards to the instance:

    ``` bash
    cloud-sql-proxy --port 5432 \
      "$GCP_PROJECT_ID:$GCP_REGION:structured-data-dev"
    ```

4.  Point `DATABASE_URL` at localhost. Nothing else in the application
    changes:

    ``` text
    DATABASE_URL=postgresql://app_user:<password>@127.0.0.1:5432/structured_data
    ```

5.  Optionally run it as a compose service instead of a loose process:

    ``` yaml
    cloudsql-proxy:
      image: gcr.io/cloud-sql-connectors/cloud-sql-proxy:2
      command:
        - "--address=0.0.0.0"
        - "--port=5432"
        - "${INSTANCE_CONNECTION_NAME}"
      volumes:
        - ~/.config/gcloud:/gcloud:ro
      environment:
        GOOGLE_APPLICATION_CREDENTIALS: /gcloud/application_default_credentials.json
      ports:
        - "5432:5432"
    ```

    Mounting ADC read-only is acceptable for local development. **Do not
    bake a service-account key into this image**, and do not commit one
    (§6.6, §39).

The developer running this needs `roles/cloudsql.client` on their own
user principal.

------------------------------------------------------------------------

## 36.3 Vercel — the connector library

**There is no sidecar and no persistent process on Vercel, so the proxy
binary is not an option.** The supported equivalent is
`@google-cloud/cloud-sql-connector`, which is the Auth Proxy compiled
into the Node process: same IAM check, same ephemeral mTLS certificates,
no open ports, no IP allowlist, and no static credentials.

**Steps**

1.  Install:

    ``` bash
    npm install @google-cloud/cloud-sql-connector pg
    ```

2.  Grant the **Vercel** service account (the one Vercel impersonates
    through Workload Identity Federation, §37) `roles/cloudsql.client`.

3.  Give the Cloud SQL instance a **public IP**. This is not a security
    regression: the connector reaches the public endpoint, but the
    instance rejects anything without a valid IAM-issued client
    certificate. Set **authorized networks to empty** — the connector
    does not need one, and an empty list is what keeps everything else
    out. Set `require_ssl = true`.

    ``` hcl
    settings {
      ip_configuration {
        ipv4_enabled        = true
        ssl_mode            = "ENCRYPTED_ONLY"
        authorized_networks = []   # deliberately empty
      }
    }
    ```

4.  Create the pool lazily, at module scope but not at import-time
    evaluation, and reuse it across warm invocations:

    ``` ts
    // src/server/db/client.ts
    import { Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector'
    import { Pool } from 'pg'

    let pool: Pool | undefined

    export async function getPool(): Promise<Pool> {
      if (pool) return pool

      const connector = new Connector()
      const clientOpts = await connector.getOptions({
        instanceConnectionName: process.env.INSTANCE_CONNECTION_NAME!,
        ipType: IpAddressTypes.PUBLIC,
      })

      pool = new Pool({
        ...clientOpts,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        max: 2,                       // see step 5
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 5_000,
      })
      return pool
    }
    ```

    **Do not call `getPool()` at module scope.** It authenticates, and
    there is no OIDC token during `next build` — an eager call makes the
    build fail. Call it inside the route handler. This is the same
    constraint as §37.4.

5.  **Bound the connections.** This is the failure mode that does not
    appear in testing and appears immediately in production. Every warm
    Vercel function instance holds its own pool; concurrency is not
    shared between them. Budget:

    ``` text
    max_connections on the instance      (db-g1-small default ~ 200)
      - reserved for superuser                       ~ 3
      - Cloud Run worker (3 instances x 2)             6
      - migrations / admin                             5
      = headroom for Vercel                        ~ 186

    Vercel:  max: 2  x  concurrent function instances
    ```

    `max: 2` with a 10s idle timeout is the right starting point. If
    connection counts still climb, the answer is a pooler in front of
    Cloud SQL (Cloud SQL's managed connection pooling, if available in
    `asia-south1` for the chosen tier — **verify before relying on it** —
    otherwise PgBouncer on a small Cloud Run service or GCE instance).
    Do not raise `max`.

6.  Monitor `cloudsql.googleapis.com/database/postgresql/num_backends`
    and alert at 70% of `max_connections`. Connection exhaustion
    presents as unrelated 500s all over the API and is very hard to
    diagnose from the symptom.

------------------------------------------------------------------------

## 36.4 Rules that apply everywhere

-   Do not use the PostgreSQL superuser from application code (§11).
    The app user gets `CONNECT`, `USAGE` on the schema, and
    `SELECT/INSERT/UPDATE/DELETE` on the application tables. Migrations
    run as a separate, more privileged user.
-   The database password lives in **Secret Manager**, injected as an
    environment variable by Cloud Run and stored as a Vercel environment
    variable. It is never committed (§39).
-   **`DATABASE_URL` and every `DB_*` variable must never be exposed to
    browser code.** In Next.js that means never prefixing them with
    `NEXT_PUBLIC_`, and keeping all database access in
    `src/server/**` modules that are only imported by route handlers.
-   Migrations are additive during the build — add columns, do not
    rename or drop — so a brief skew between a deployed Vercel build and
    a deployed worker degrades rather than breaks.

------------------------------------------------------------------------

# 37. Authentication Between Vercel and GCP

Preferred architecture:

``` text
Vercel
   |
   | OIDC token
   v
Google STS  (Workload Identity Federation)
   |
   | federated access token
   v
Service account impersonation      <-- REQUIRED, see §37.1
   |
   v
Vercel service account
   |
   +--> GCS signed URL generation   (via IAM signBlob)
   |
   +--> Pub/Sub publish
   |
   +--> Cloud SQL connector
```

Do not use a static Google service-account private key in Vercel.

The human administrator must configure the required Vercel/GCP
federation relationship.

**The four subsections below are runtime requirements, not hardening.**
Each of them fails at request time in production, not at build time and
not in CI, and three of the four produce error messages that point
somewhere else.

------------------------------------------------------------------------

## 37.1 Impersonation is mandatory, because signing needs a signer

Workload Identity Federation supports two shapes: *direct resource
access*, where the federated principal is granted roles itself, and
*service account impersonation*, where it borrows a service account.
Direct resource access is the simpler of the two and **will not work
here**.

V4 signed-URL generation normally signs with a service account's private
key. There is no private key anywhere in this architecture, so the
Google auth libraries fall back to the IAM Credentials **`signBlob`**
API — and to call it they must know *whose* identity to sign as. That
identity comes from the credential's `client_email`. A direct-access
external-account credential has no `client_email`, and the failure is:

``` text
Error: Cannot sign data without `client_email`.
```

So the external-account credential config Vercel uses must include
`service_account_impersonation_url`:

``` json
{
  "type": "external_account",
  "audience": "//iam.googleapis.com/projects/<NUM>/locations/global/workloadIdentityPools/<POOL>/providers/<PROVIDER>",
  "subject_token_type": "urn:ietf:params:oauth:token-type:jwt",
  "token_url": "https://sts.googleapis.com/v1/token",
  "service_account_impersonation_url":
    "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/<SA_EMAIL>:generateAccessToken",
  "credential_source": { "...": "Vercel OIDC token" }
}
```

## 37.2 Two IAM bindings, both easy to miss

``` hcl
# (a) lets the Vercel OIDC principal impersonate the service account
resource "google_service_account_iam_member" "vercel_wif" {
  service_account_id = google_service_account.vercel.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.main.name}/attribute.owner/${var.vercel_team_slug}"
}

# (b) lets the service account sign blobs AS ITSELF — this is the one
#     that is always forgotten, and it is what makes signed URLs work
resource "google_service_account_iam_member" "vercel_token_creator" {
  service_account_id = google_service_account.vercel.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.vercel.email}"
}
```

Binding (b) is a self-binding and looks redundant. It is not.
`roles/storage.objectAdmin` does not grant signing; `signBlob` is an IAM
Credentials permission and needs `roles/iam.serviceAccountTokenCreator`
on the target service account. Without it, every call to
`/api/uploads/init` returns 500 with
`Permission 'iam.serviceAccounts.signBlob' denied`.

`iamcredentials.googleapis.com` is already in §6.2 and must stay.

## 37.3 Audience and attribute condition must match Vercel exactly

The WIF provider is configured with Vercel's issuer and audience. Both
are team-scoped and a mismatch fails at request time with an opaque STS
error:

``` text
issuer    https://oidc.vercel.com/<team-slug>
audience  https://vercel.com/<team-slug>
```

Pin the attribute condition so that only *this* project can assume the
service account — an unconditioned pool trusts every project in the
Vercel team:

``` hcl
attribute_condition = "assertion.owner == '${var.vercel_team_slug}' && assertion.project == '${var.vercel_project_name}'"
```

**Do not add `assertion.environment == 'production'`** unless preview
deployments are meant to be broken. Previews carry
`environment: "preview"` and will be rejected at runtime while building
and deploying perfectly. If previews must be excluded, exclude them
deliberately and write it down here.

Vercel's OIDC setting must be enabled on the project, in **team-scoped**
issuer mode, matching whatever the pool was configured with.

## 37.4 Lazy client initialisation

`VERCEL_OIDC_TOKEN` is injected into the function **at request time**.
It does not exist during `next build`, and it does not exist under a
plain `next dev`.

``` ts
// WRONG — runs at import, has no token, breaks the build
const storage = new Storage()

// RIGHT — first request pays for it, warm invocations reuse it
let storage: Storage | undefined
function getStorage() {
  return (storage ??= new Storage())
}
```

Every GCP client — Storage, PubSub, and the Cloud SQL connector in
§36.3 — must be constructed inside the request path. A client
constructed at module scope that eagerly resolves credentials will fail
the Vercel build with an authentication error that names credentials
rather than timing.

For **local development**, `next dev` has no OIDC token at all. Use
`vercel env pull` and `vercel dev`, or accept that `/api/uploads/init`
only works against a deployed preview. Local test failure here is
expected and is not evidence of a misconfiguration.

## 37.5 Cost of signing

Every signed URL is now an extra network round trip to
`iamcredentials.googleapis.com` — roughly 50–150 ms from a Vercel
function, on top of the STS exchange (which the auth library caches).
Acceptable for one signature per upload. If a future flow needs to sign
many URLs at once, batch them in a single handler rather than signing
per file in a loop from the client.

------------------------------------------------------------------------

# 38. Application Configuration

Create:

``` text
packages/web/.env.example
```

without secrets.

Example:

``` text
GCP_PROJECT_ID=
GCP_PROJECT_NUMBER=
GCP_REGION=asia-south1

GCS_BUCKET_NAME=

PUBSUB_TOPIC_NAME=

GCP_SERVICE_ACCOUNT_EMAIL=
GCP_WORKLOAD_IDENTITY_POOL_ID=
GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=

# Cloud SQL — via @google-cloud/cloud-sql-connector (§36.3).
# There is no DATABASE_URL on Vercel: the connector supplies the
# transport, and the credentials are supplied separately.
INSTANCE_CONNECTION_NAME=      # project:region:instance
DB_NAME=
DB_USER=
DB_PASSWORD=

# Upload limits (§16)
MAX_UPLOAD_BYTES=
ALLOWED_CONTENT_TYPES=
```

**Note the change from earlier drafts:** Vercel no longer uses a
`DATABASE_URL`. §36.3 connects through the connector library, which
needs the instance connection name and the credentials as separate
values. A `DATABASE_URL` is still the right shape for **local
development** through `cloud-sql-proxy` (§36.2), so keep it in
`.env.local` only:

``` text
# local only — cloud-sql-proxy on 127.0.0.1
DATABASE_URL=postgresql://app_user:<password>@127.0.0.1:5432/structured_data
```

`DATABASE_URL` and `DB_PASSWORD` must not be committed with credentials,
and must never be prefixed `NEXT_PUBLIC_`.

The worker should have its own example configuration:

``` text
packages/worker/.env.example
```

containing non-secret configuration names.

------------------------------------------------------------------------

# 39. Secrets Policy

Never commit:

``` text
.env
.env.local
*.json credentials
service-account JSON
private keys
database passwords
```

Ensure `.gitignore` covers them.

The coding agent must inspect the existing `.gitignore` and extend it if
necessary.

------------------------------------------------------------------------

# 40. Health Checks

A single `{"status":"ok"}` endpoint answers "is the process running",
which is the one question that is never in doubt when something is
actually wrong. This system has three distinct failure modes — the
process is dead, its dependencies are unreachable, or **it is running
fine and no work is moving** — and they need three different answers.

Three endpoints on the worker, one on Next.js.

------------------------------------------------------------------------

## 40.1 `GET /health` — liveness

Process is up. **No dependency calls. No database.** Must answer in
single-digit milliseconds and must never fail because of something
outside the process.

``` json
{ "status": "ok" }
```

This is the only endpoint Cloud Run probes point at (§34.1). A liveness
probe that touches PostgreSQL turns a database blip into a restart loop,
which turns a five-minute incident into a thirty-minute one.

------------------------------------------------------------------------

## 40.2 `GET /readyz` — readiness

Can this instance do work right now? Check dependencies, with short
timeouts, in parallel:

``` text
SELECT 1                      timeout 2s
GCS bucket metadata read      timeout 2s
```

``` json
{
  "status": "ok",
  "checks": { "database": "ok", "storage": "ok" }
}
```

`200` if all pass, **`503`** if any fails, with the failing check named.
Not wired to a Cloud Run probe — it exists for deploy verification and
for a human debugging a boundary (§43).

------------------------------------------------------------------------

## 40.3 `GET /healthz` — is work actually moving

The one that distinguishes *alive* from *stuck*. Everything here is a
cheap aggregate over tables this plan already defines.

``` json
{
  "status": "ok",
  "version": "<git sha>",
  "database": "ok",
  "queue": {
    "queued": 3,
    "processing": 1,
    "stuck": 0,
    "oldest_queued_age_s": 12
  },
  "outbox": {
    "pending": 0,
    "dead": 0,
    "oldest_pending_age_s": 0
  },
  "dlq_depth": 0
}
```

Definitions, so the numbers mean one thing:

``` text
queued                status = 'QUEUED'
processing            status = 'PROCESSING' AND claimed_until >= now()
stuck                 status = 'PROCESSING' AND claimed_until <  now()
oldest_queued_age_s   now() - min(created_at)  over queued jobs
outbox.pending        status = 'PENDING'
outbox.dead           status = 'DEAD'
oldest_pending_age_s  now() - min(created_at)  over pending outbox rows
dlq_depth             from Cloud Monitoring; 0 if unavailable
```

Status degrades on the numbers, not on liveness:

| Condition | `status` | What it means |
|---|---|---|
| all clear | `ok` | — |
| `outbox.oldest_pending_age_s > 300` | `degraded` | **The scheduled sweep is not running.** Jobs are being created and never queued |
| `queue.stuck > 0` | `degraded` | Workers died mid-job; the reaper has not caught up |
| `queue.oldest_queued_age_s > 900` | `degraded` | Messages are not arriving, or every delivery is nacking |
| `outbox.dead > 0` or `dlq_depth > 0` | `degraded` | Something gave up permanently. A human needs to look |
| `SELECT 1` fails | `unhealthy` | — |

Return `200` for `ok` and `degraded`, `503` for `unhealthy`. `degraded`
must not return 503: it is the *monitoring* signal, and a 503 here would
make Cloud Run's load balancer pull a perfectly serviceable instance out
of rotation at exactly the moment the backlog needs draining.

Implement as **one** SQL statement of `COUNT(*) FILTER (WHERE ...)`
aggregates. This endpoint is polled; it must not become the load.

------------------------------------------------------------------------

## 40.4 `GET /api/health` — Next.js

The API's own liveness, plus whether it can reach PostgreSQL:

``` json
{ "status": "ok", "database": "ok" }
```

`503` when the database check fails. Do **not** re-implement the queue
aggregates here — they belong to the worker, which owns that state.

------------------------------------------------------------------------

## 40.5 Alerting

The health endpoint is only worth building if something reads it. Add
Cloud Monitoring alert policies (`monitoring.tf`) on:

``` text
outbox.oldest_pending_age_s > 300      the sweep has stopped
queue.stuck > 0        for 10 minutes  workers dying mid-job
dlq_depth > 0                          poison messages
num_backends > 70% of max_connections  connection exhaustion (§36.3)
```

An uptime check against `/healthz` is the simplest way to feed these, and
it also catches the case where the service itself is gone.

------------------------------------------------------------------------

Health checks must not expose credentials, connection strings, instance
connection names, bucket names, or infrastructure secrets. Counts and a
git SHA only.

------------------------------------------------------------------------

# 41. Testing Strategy

Testing must be modular.

Do not jump directly to an end-to-end test.

The following sequence must be followed.

------------------------------------------------------------------------

## Test Module 1 --- Repository

Verify:

``` text
existing frontend still runs
existing frontend still builds
existing lint still passes
```

No backend work should break the existing frontend.

------------------------------------------------------------------------

## Test Module 2 --- Terraform

Run:

``` bash
terraform fmt -check
terraform validate
terraform plan
```

Review the plan.

Only then:

``` bash
terraform apply
```

Verify resources using Google Cloud tooling.

------------------------------------------------------------------------

## Test Module 3 --- GCS

Verify:

-   bucket exists;
-   bucket is not publicly writable;
-   bucket CORS configuration is present and lists the expected origins;
-   signed URL can upload **from `curl`**;
-   signed URL can upload **from a browser page served on
    `http://localhost:3000`** — this is the check that exercises the
    CORS preflight, and it is the one that fails when §9.1 was skipped;
-   the browser `PUT` sends exactly the `Content-Type` that was signed;
-   uploaded object appears.

A `curl` upload passing while a browser upload fails is a CORS problem,
not a signing problem. A browser upload failing with
`SignatureDoesNotMatch` behind a CORS-shaped console error is a
Content-Type problem. Distinguish these two before changing anything.

------------------------------------------------------------------------

## Test Module 4 --- PostgreSQL

Verify:

-   Cloud SQL exists;
-   database exists;
-   migrations run;
-   tables exist;
-   application can connect;
-   worker can connect.

------------------------------------------------------------------------

## Test Module 5 --- Next.js Upload API

Start locally.

Call:

``` http
POST /api/uploads/init
```

Verify:

-   validation works;
-   file record is created;
-   signed URL is returned;
-   no credentials are returned.

Upload a small test file using the returned URL.

Verify the object exists in GCS.

------------------------------------------------------------------------

## Test Module 6 --- Next.js Job API

Call:

``` http
POST /api/jobs
```

Verify:

-   file ownership is checked;
-   GCS object existence is checked;
-   job is created with `status = QUEUED`;
-   job_files row exists;
-   `JOB_CREATED` and `JOB_QUEUED` events exist;
-   a `job_outbox` row exists;
-   Pub/Sub message is published and the outbox row becomes `PUBLISHED`.

Then verify the outbox actually works, which is the only part that
matters:

-   **Publish failure.** Point the publisher at a non-existent topic, or
    revoke `roles/pubsub.publisher` on the Vercel service account. Call
    `POST /api/jobs`. The API must still return `201` with a job id, the
    job must be `QUEUED`, and the outbox row must remain `PENDING` with
    `attempts >= 1`. **The job must not be `FAILED`.**
-   **Recovery.** Restore the topic/permission and trigger
    `POST /internal/sweep`. The outbox row becomes `PUBLISHED` and the
    job runs to `COMPLETED` without any client action.
-   **Atomicity.** Force an error between the job insert and the outbox
    insert. Neither row may exist afterwards.
-   **Give-up.** Force `attempts` to 10 on a pending row and sweep. The
    row becomes `DEAD` and the job becomes `FAILED` /
    `PUBSUB_PUBLISH_FAILED`.

------------------------------------------------------------------------

## Test Module 6b --- Leasing and recovery

These are the tests that cannot be written later, because by then the
behaviour is load-bearing and undiscovered.

-   **Duplicate delivery.** Send the same Pub/Sub envelope twice in
    sequence. Second call returns `200`, job stays `COMPLETED`, exactly
    one `OUTPUT_WRITTEN` event exists.
-   **Concurrent delivery.** Send the same envelope twice
    simultaneously. Exactly one claim succeeds. The loser returns `409`.
    Assert against a **real PostgreSQL** — the conditional `UPDATE` is a
    database behaviour and mocking it tests your belief about PostgreSQL
    rather than PostgreSQL.
-   **Crash mid-job.** Kill the worker after it marks `PROCESSING`.
    Confirm `claimed_until` is in the future and the job is untouched.
    Advance the clock past the lease (or write an expired
    `claimed_until` directly), run the sweep, and confirm the job
    returns to `QUEUED`, a new outbox row is created, a `JOB_RECLAIMED`
    event is written, and reprocessing completes it.
-   **Exhaustion.** Set `attempts = max_attempts` on a `PROCESSING` job
    with an expired lease. Sweep. Job becomes `FAILED` /
    `WORKER_MAX_ATTEMPTS`, and is **not** re-queued.
-   **Live lease.** Deliver a message for a job claimed by another
    instance whose lease is still valid. Must return `409`, and must not
    touch the job row.
-   **Lease renewal.** Run a job longer than one lease duration with the
    renewal task active. Confirm `claimed_until` advances and the reaper
    does not steal it.

------------------------------------------------------------------------

## Test Module 7 --- Worker Locally

Build the Docker image.

Run the worker locally.

Send a synthetic Pub/Sub envelope.

Verify:

``` text
HTTP 2xx
```

and:

``` text
output/result.txt
```

appears in GCS.

------------------------------------------------------------------------

## Test Module 8 --- Cloud Run

Deploy the Docker image.

Verify:

``` text
Cloud Run service exists
/health responds without touching the database
/readyz reports database and storage ok
/healthz returns queue and outbox aggregates
service cannot be anonymously invoked
```

Then verify Terraform and the pipeline are not fighting (§34.2):

``` bash
gcloud run deploy ... --image <digest>      # pipeline deploys
terraform plan                               # must be EMPTY
```

A non-empty plan here means `ignore_changes` is missing or incomplete,
and the next `terraform apply` will roll production back to the
placeholder image.

------------------------------------------------------------------------

## Test Module 8b --- Cloud Scheduler

Verify:

-   the scheduler job exists and targets `POST /internal/sweep`;
-   it authenticates with an OIDC token and the worker rejects an
    unauthenticated call to the same path;
-   a manual `gcloud scheduler jobs run` produces a sweep in the logs;
-   the sweep is a no-op when there is nothing to do, and says so.

**Do not skip this module.** The scheduler is the only recovery path for
both §24 and §31.2. A system with a broken sweep looks completely healthy
right up until the first failure it was supposed to catch.

------------------------------------------------------------------------

## Test Module 9 --- Pub/Sub → Cloud Run

Publish a message manually.

Verify:

``` text
Pub/Sub
   |
   v
Cloud Run
   |
   v
GCS output
```

Inspect Cloud Run logs.

------------------------------------------------------------------------

## Test Module 10 --- Job Status

After worker execution:

``` http
GET /api/jobs/<jobId>
```

must return:

``` json
{
  "status": "COMPLETED"
}
```

and the output location.

------------------------------------------------------------------------

# 42. End-to-End Acceptance Test

Use:

``` text
hello.txt
```

Contents:

``` text
Hello backend.
```

Perform:

``` text
1. Open Vercel application
2. Select hello.txt
3. Click Upload/Process
4. Next.js initializes upload
5. Browser uploads directly to GCS
6. Next.js creates job
7. PostgreSQL stores job
8. Next.js publishes Pub/Sub message
9. Pub/Sub pushes message to Cloud Run
10. Cloud Run loads job from PostgreSQL
11. Cloud Run reads hello.txt from GCS
12. Cloud Run creates result.txt
13. Cloud Run writes result.txt to GCS
14. Cloud Run marks job COMPLETED
15. Frontend polls GET /api/jobs/:jobId
16. Frontend displays COMPLETED
```

Final GCS output:

``` text
uploads/<jobId>/output/result.txt
```

Content:

``` text
Successfully processed hello.txt
```

This exact test is the final acceptance criterion.

------------------------------------------------------------------------

# 43. Debugging Protocol

When a test fails, debug only one boundary at a time.

Use this sequence:

``` text
1. Next.js application
       |
2. /api/uploads/init
       |
3. signed URL
       |
4. browser -> GCS
       |
5. PostgreSQL
       |
6. /api/jobs
       |
7. Pub/Sub publish
       |
8. Pub/Sub subscription
       |
9. authenticated Cloud Run invocation
       |
10. Cloud Run worker
       |
11. Cloud Run -> PostgreSQL
       |
12. Cloud Run -> GCS read
       |
13. Cloud Run -> GCS write
       |
14. job status update
       |
15. frontend status retrieval
```

Do not debug later components until earlier boundaries pass.

------------------------------------------------------------------------

# 44. Required Logging

Every backend operation must include enough context to identify the job.

For example:

``` text
jobId
fileId
event type
stage
error code
```

Worker logs should include:

``` text
job_id
file_id
gcs_object
event
```

Do not log:

-   file contents;
-   database passwords;
-   access tokens;
-   signed URLs;
-   private keys;
-   secrets.

------------------------------------------------------------------------

# 45. Error Codes

Use stable machine-readable error codes.

Examples:

``` text
INVALID_UPLOAD
UNSUPPORTED_CONTENT_TYPE
UPLOAD_NOT_FOUND
UPLOAD_NOT_COMPLETE
FILE_ACCESS_DENIED
GCS_OBJECT_NOT_FOUND
JOB_NOT_FOUND
PUBSUB_PUBLISH_FAILED
WORKER_PROCESSING_FAILED
WORKER_MAX_ATTEMPTS
JOB_LEASE_HELD
DATABASE_ERROR
OUTPUT_WRITE_FAILED
```

`PUBSUB_PUBLISH_FAILED` is now terminal only after the outbox has
exhausted its retries (§24.3). It is never set on a first publish error.

`WORKER_MAX_ATTEMPTS` is set by the reaper (§31.2) when a job has been
claimed `max_attempts` times without completing.

`JOB_LEASE_HELD` accompanies the `409` in §31.1 and is an internal
signal to Pub/Sub, not a user-facing error.

Do not expose raw infrastructure stack traces to users.

------------------------------------------------------------------------

# 46. HTTP Error Behavior

Suggested behavior:

``` text
400 → invalid request
401 → unauthenticated
403 → unauthorized
404 → resource not found
409 → invalid state/conflict
413 → upload too large
500 → unexpected server error
503 → temporary infrastructure failure
```

Use consistent JSON error responses.

------------------------------------------------------------------------

# 47. Frontend Integration

The existing frontend must be minimally modified to support:

``` text
Select file
    |
    v
Initialize upload
    |
    v
Upload directly to GCS
    |
    v
Create job
    |
    v
Show job ID/status
    |
    v
Poll job status
    |
    v
Show completed state
```

Do not redesign the UI.

Do not implement the future extraction UI.

------------------------------------------------------------------------

# 48. Sequential Coding-Agent Execution Rules

The coding agent MUST follow these rules.

## Rule 1

Inspect before changing.

## Rule 2

Implement one milestone at a time.

## Rule 3

Run tests after each milestone.

## Rule 4

Do not proceed when a foundational test fails.

## Rule 5

Do not silently change architecture.

## Rule 6

Do not add unnecessary dependencies.

## Rule 7

Do not expose credentials.

## Rule 8

Do not put file bytes through Vercel.

## Rule 9

Do not implement document intelligence in this phase.

## Rule 10

After each milestone, report:

``` text
Completed:
Tests:
Files changed:
Infrastructure changed:
Known issues:
Next milestone:
```

------------------------------------------------------------------------

# 49. Milestones

## Milestone 0 --- Repository Discovery

Deliver:

``` text
docs/backend-infrastructure-discovery.md
```

Include:

-   existing repository structure;
-   package manager;
-   Next.js version;
-   current API structure;
-   database state;
-   authentication state;
-   proposed integration points;
-   dependency changes.

STOP if repository assumptions conflict with this plan.

------------------------------------------------------------------------

## Milestone 1 --- Terraform Foundation

Create:

``` text
infra/terraform/
```

Implement:

-   GCP APIs;
-   GCS, **including the CORS configuration (§9.1)**;
-   Cloud SQL, with public IP, `require_ssl`, and **empty** authorized
    networks (§36.3);
-   Pub/Sub topic, push subscription, **dead-letter topic and policy
    (§31.3)**;
-   Artifact Registry;
-   Cloud Run service with a **placeholder image and `ignore_changes`
    on the image (§34.2)**;
-   **Cloud Scheduler job targeting `POST /internal/sweep` (§24.3)**;
-   service accounts, including the **scheduler invoker**;
-   IAM — including `roles/cloudsql.client` on both the worker and
    Vercel service accounts, and the **`serviceAccountTokenCreator`
    self-binding (§37.2)**;
-   Workload Identity Federation, with **service account impersonation
    (§37.1)** and the attribute condition of §37.3;
-   Cloud Monitoring alert policies (§40.5).

Run:

``` bash
terraform fmt
terraform validate
terraform plan
```

Human reviews plan.

Then:

``` bash
terraform apply
```

------------------------------------------------------------------------

## Milestone 2 --- PostgreSQL

Implement:

-   ORM/database client;
-   schema;
-   migrations;
-   repositories;
-   local connectivity;
-   Cloud SQL connectivity.

Verify:

``` text
users
files
jobs          (including attempts / claimed_by / claimed_until)
job_files
job_events
job_outbox
```

exist, along with the indexes on `jobs (status, claimed_until)` and
`job_outbox (status, next_attempt_at)`.

Connectivity must be proven on all three surfaces of §36:

``` text
local  -> cloud-sql-proxy binary        (§36.2)
worker -> /cloudsql unix socket         (§36.1)
Vercel -> cloud-sql-connector library   (§36.3)
```

------------------------------------------------------------------------

## Milestone 3 --- GCS Service

Implement:

``` text
GCS client
signed upload URL generation
object metadata verification
```

Do not implement file processing.

------------------------------------------------------------------------

## Milestone 4 --- Upload API

Implement:

``` http
POST /api/uploads/init
```

Test:

``` text
API
 ↓
signed URL
 ↓
browser
 ↓
GCS
```

------------------------------------------------------------------------

## Milestone 5 --- Python Worker Skeleton

Implement:

``` text
FastAPI
Pub/Sub envelope parsing
PostgreSQL access (via /cloudsql socket)
GCS access
conditional-UPDATE job claim + lease renewal   (§31.1, §31.2)
POST /internal/sweep  — outbox relay + reaper  (§24.3, §31.2)
GET /health · GET /readyz · GET /healthz       (§40)
Dockerfile
tests
```

Worker must be able to process the trivial job.

Run **Test Module 6b** here, against a real PostgreSQL in
testcontainers. The claim semantics cannot be mocked.

------------------------------------------------------------------------

## Milestone 6 --- Local Worker E2E

Run:

``` text
Docker
 ↓
synthetic Pub/Sub request
 ↓
PostgreSQL
 ↓
GCS
```

Verify `result.txt`.

------------------------------------------------------------------------

## Milestone 7 --- Cloud Run Deployment

Build:

``` text
Docker image
```

Push:

``` text
Artifact Registry
```

Deploy:

``` text
Cloud Run
```

Verify health endpoint and IAM protection.

------------------------------------------------------------------------

## Milestone 8 --- Pub/Sub Integration

Configure:

``` text
topic
subscription
push endpoint
OIDC
run.invoker
ack deadline 600s
dead-letter topic + policy (max 5 attempts)
```

Publish a test message.

Verify Cloud Run receives it.

Verify a message for a non-existent job is **acked** (200) rather than
cycling to the DLQ, per §31.1.

------------------------------------------------------------------------

## Milestone 8b --- Scheduler and Sweep

Configure the Cloud Scheduler job against `POST /internal/sweep` with an
OIDC token and the scheduler invoker service account.

Run **Test Module 8b**.

This milestone must not be deferred to "after E2E works". The outbox
and the reaper are only real once something calls them on a timer.

------------------------------------------------------------------------

## Milestone 9 --- Job API

Implement:

``` http
POST /api/jobs        (transactional: job + job_files + events + outbox)
GET /api/jobs/:jobId
```

Connect:

``` text
PostgreSQL
+
Pub/Sub (best-effort inline publish)
```

Run **Test Module 6**, including the publish-failure and recovery cases.

------------------------------------------------------------------------

## Milestone 10 --- Frontend Integration

Connect existing UI to:

``` text
upload
process
poll
completed
```

Minimal UI changes only.

------------------------------------------------------------------------

## Milestone 11 --- Full E2E

Run the exact:

``` text
hello.txt
```

acceptance test.

------------------------------------------------------------------------

# 50. Final Definition of Done

The task is complete only when ALL of the following are true.

## Repository

-   [ ] Existing Next.js frontend still works.
-   [ ] TypeScript passes.
-   [ ] Lint passes.
-   [ ] Existing tests pass.
-   [ ] New tests pass.

## Terraform

-   [ ] Terraform validates.
-   [ ] Terraform can create the required GCP resources.
-   [ ] Terraform outputs required configuration.
-   [ ] Infrastructure can be reproduced.

## GCS

-   [ ] Bucket exists.
-   [ ] Bucket is not publicly writable.
-   [ ] Bucket CORS is configured for the expected origins.
-   [ ] Signed upload works from `curl`.
-   [ ] Signed upload works **from a browser** (CORS preflight passes).
-   [ ] Browser uploads directly to GCS.

## PostgreSQL

-   [ ] Cloud SQL exists.
-   [ ] Database exists.
-   [ ] Authorized networks are empty; SSL is required.
-   [ ] Migrations work.
-   [ ] Application can connect **via the connector library from a
    deployed Vercel function**.
-   [ ] Worker can connect **via the `/cloudsql` socket**.
-   [ ] A developer can connect **via `cloud-sql-proxy`**.
-   [ ] Connection counts stay bounded under repeated API calls.
-   [ ] Job metadata is persisted.

## Next.js

-   [ ] `/api/uploads/init` works **on a deployed Vercel
    environment** (signed URL generation over WIF + `signBlob`).
-   [ ] `/api/jobs` works.
-   [ ] `/api/jobs/:jobId` works.
-   [ ] Authentication/ownership checks exist.
-   [ ] No file bytes are proxied through Vercel.
-   [ ] No GCP client is constructed at module scope.

## Pub/Sub

-   [ ] Topic exists.
-   [ ] Subscription exists.
-   [ ] Dead-letter topic and policy exist.
-   [ ] Publishing works.
-   [ ] Push authentication works.

## Transactional consistency

-   [ ] Job, job_files, events and outbox row are written in one
    transaction.
-   [ ] A publish failure leaves the job `QUEUED` and the outbox
    `PENDING` — **not** `FAILED`.
-   [ ] The scheduled sweep recovers that job with no client action.
-   [ ] An exhausted outbox row becomes `DEAD` and fails the job once.

## Leasing and recovery

-   [ ] A job can only enter `PROCESSING` through the conditional
    claim.
-   [ ] Two concurrent deliveries produce exactly one claim.
-   [ ] A duplicate delivery of a completed job returns 200 and writes
    nothing.
-   [ ] A worker killed mid-job has its job reclaimed after the lease
    expires.
-   [ ] A job exceeding `max_attempts` fails terminally and is not
    re-queued.
-   [ ] Lease renewal keeps a long job from being stolen.

## Cloud Run

-   [ ] Python worker image builds.
-   [ ] Image exists in Artifact Registry.
-   [ ] Cloud Run service is deployed.
-   [ ] Service is not anonymously invokable.
-   [ ] `terraform plan` is empty after a pipeline image deploy.
-   [ ] Worker can read PostgreSQL.
-   [ ] Worker can read GCS.
-   [ ] Worker can write GCS.

## Scheduler and health

-   [ ] Cloud Scheduler job exists and invokes `/internal/sweep` with
    OIDC.
-   [ ] `/internal/sweep` rejects unauthenticated calls.
-   [ ] `/health` answers without touching the database.
-   [ ] `/readyz` returns 503 when PostgreSQL is unreachable.
-   [ ] `/healthz` reports queue, stuck, outbox and DLQ counts.
-   [ ] `/healthz` returns `degraded` with HTTP 200, never 503.
-   [ ] Alert policies exist for a stalled sweep, stuck jobs, DLQ depth
    and connection exhaustion.

## End-to-end

-   [ ] `hello.txt` can be uploaded.
-   [ ] Job is created.
-   [ ] Pub/Sub message is published.
-   [ ] Cloud Run receives message.
-   [ ] Cloud Run fetches the file.
-   [ ] Cloud Run writes `result.txt`.
-   [ ] Job becomes `COMPLETED`.
-   [ ] Output contains:

``` text
Successfully processed hello.txt
```

------------------------------------------------------------------------

# 51. Explicitly Out of Scope

Do not implement any of these during this task:

``` text
Gemini
Gemini API keys
Document AI
OCR
Whisper
PDF parsing
XLSX parsing
CSV semantic processing
CanonicalDocument
schema inference
JSON Schema generation
structured extraction
LLM validation
LLM repair
confidence scoring
provenance
multi-file semantic processing
complex workflow orchestration
Redis
Kafka
Kubernetes
Elasticsearch
```

**The transactional outbox is no longer out of scope.** It moved into
this phase (§24) because retrofitting it after the extraction engine
lands is materially more expensive — by then the job row carries real,
paid-for work, and the dual-write window stops being theoretical.

The Python worker is intentionally a skeleton.

The next phase will replace:

``` text
processor.py
```

with the actual unstructured-to-structured processing engine.

The Cloud Run deployment, Pub/Sub contract, PostgreSQL job model, GCS
storage contract, and Next.js API contract should remain stable while
that happens.

------------------------------------------------------------------------

# 52. Target Final Architecture

``` text
                         USER
                           |
                           v
                 +-------------------+
                 | Next.js Frontend  |
                 |     Vercel        |
                 +---------+---------+
                           |
             +-------------+-------------+
             |                           |
             v                           v
    POST /api/uploads/init       POST /api/jobs
             |                           |
             v                           v
       GCS Signed URL              PostgreSQL
             |                           |
             v                           v
          GCS Object                  Job
             |                           |
             |                           v
             |                     job + outbox row
             |                    (one transaction)
             |                           |
             |                           v
             |                       Pub/Sub
             |                           |
             |                           v
             |                    Authenticated Push
             |                           |
             |                           v
             |                    +-------------+
             |                    | Cloud Run   |<--- Cloud Scheduler
             |                    | Python      |     POST /internal/sweep
             |                    | Worker      |     (outbox relay +
             |                    +------+------+      lease reaper)
             |                           |
             |                     claim with lease
             |                           |
             |              +------------+------------+
             |              |                         |
             |              v                         v
             |         PostgreSQL                    GCS
             |         load job/file              read input
             |                                           |
             |                                           v
             |                                      process
             |                                           |
             |                                           v
             +------------------------------------ GCS output

                                      |
                                      v

                            result.txt

                    "Successfully processed
                         hello.txt"
```

This is the baseline architecture that the future Python extraction
engine will plug into.
