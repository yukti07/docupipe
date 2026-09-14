# Backend Infrastructure Execution Plan

## Next.js on Vercel + Google Cloud Storage + Cloud SQL PostgreSQL + Pub/Sub + Python Cloud Run Worker

**Status:** Ready for execution by a coding agent\
**Scope:** Core backend infrastructure and end-to-end processing
pipeline only\
**Out of scope:** Document extraction/intelligence implementation,
Gemini, OCR, schema inference, canonical document logic, PDF/XLSX/CSV
semantic processing, Whisper, and other domain-specific processors.

------------------------------------------------------------------------

# 0. The client API contract — the seven endpoints

**This section is authoritative for every route the browser calls.** It
supersedes the route *names and payload shapes* in §16, §18, §20, §21,
§22 and §25 wherever they differ. Everything else in those sections —
validation, the object key, the gate, the outbox, leasing, the failure
classes — still stands unchanged.

Seven routes. All `POST`, all JSON, all under `/api`. Reads are POSTs
because they carry a body; that is the agreed contract and it is not
worth a round of REST purity to change.

``` text
/api/register          once, on first visit
/api/getSignedUrl      once per drop      -> one signed PUT URL per file
/api/upload            after the PUTs land
/api/polling/schema    every 2s until every file has settled a shape
/api/updateSchema      on save, carrying its own apply-to-all scope
/api/convert           the gate
/api/polling/result    every 2s until the request finishes
```

**There is no SSE.** §25.4's event stream is replaced by the two polling
endpoints. `file_events` stays — it is still the audit trail and still
what §40.3 reads — but the browser no longer subscribes to it. That also
retires the serverless duration-cap problem and the `Last-Event-ID`
replay machinery that existed only to survive it.

------------------------------------------------------------------------

## 0.1 `POST /api/register`

``` json
// request
{ "userId": "usr_9f3a1c7b2e4d8a6150c3b7e29d4f8a1b" }

// response
{ "status": "ok" }
```

The client generates `userId` on first visit, stores it in the browser,
and registers it. There is no username and no password (this replaces
§12.1 entirely). The server inserts the `users` row if it is absent and
sets the signed `sid` cookie (§12.2) so that later calls have an
authority that is not the request body (§12.3).

Two rules, both load-bearing:

1.  **The id must be at least 128 bits of CSPRNG entropy.** The server
    rejects anything shorter or outside `[A-Za-z0-9_-]{22,64}` with
    `400`. This is the *entire* defence on the workspace — see below.
2.  **Registering an id that already exists succeeds.** That is not a
    bug, it is the "open this workspace in another browser" affordance
    in the design. Which means the id is a **bearer capability**:
    whoever holds it holds the workspace and everything in it. Say so in
    the UI rather than implying a private account, and never put the id
    anywhere it will be logged as a URL query string on a third party.

------------------------------------------------------------------------

## 0.2 `POST /api/getSignedUrl`

``` json
// request
{
  "userId": "usr_9f3a…",
  "requestId": "req_01KABC",
  "files": ["invoice-1043.pdf", "invoice-1044.pdf", "credit-notes.xlsx"]
}

// response
{
  "userId": "usr_9f3a…",
  "requestId": "req_01KABC",
  "files": [
    {
      "fileId": "file_7a2",
      "fileName": "invoice-1043.pdf",
      "filePath": "https://storage.googleapis.com/…&X-Goog-Signature=…",

      // required additions — see §0.8
      "uploadHeaders": { "Content-Type": "application/pdf" },
      "expiresAt": "2026-09-14T11:05:00Z"
    }
  ]
}
```

`filePath` **is the signed `PUT` URL**, not a bare object key. The object
key is chosen by the server (§17) and the client never influences it.

`requestId` is client-generated, which makes this call idempotent: the
same `requestId` twice returns the same request and the same `fileId`s
rather than creating a second request (§16).

`uploadHeaders` is a required addition and not a convenience. The
signature covers `Content-Type`; if the browser sends a byte-different
one, GCS answers `403 SignatureDoesNotMatch` with no CORS headers, and
the browser reports it to the developer as a **CORS error**, which sends
people to fix the wrong thing. §19.1 and §43.1 are the long version.

**Per-file pre-flight is client-side in this contract**, because `files`
carries names only — no size, no declared type. The client rejects empty
files, oversized files, `.zip` archives and unreadable formats before it
ever calls this. The server's real check remains the inspect worker's
magic-byte sniff, which is what raises `format_corrupt`. *Recommended
(not required):* allow `files` entries to be objects
`{ fileName, size, contentType }` so the server can refuse a 900 MB file
before signing a URL for it.

------------------------------------------------------------------------

## 0.3 `POST /api/upload`

``` json
// request
{
  "userId": "usr_9f3a…",
  "requestId": "req_01KABC",
  "files": [
    {
      "fileId": "file_7a2",
      "fileName": "invoice-1043.pdf",
      "filePath": "https://storage.googleapis.com/…",
      "fileLocation": "Q3 invoices/invoice-1043.pdf"
    }
  ]
}

// response — required addition: per-file, not a bare status
{
  "status": "ok",
  "files": [
    { "fileId": "file_7a2", "stage": "UPLOADED" },
    { "fileId": "file_7a9", "stage": "FAILED",
      "failureClass": "acquisition",
      "message": "Upload didn't finish.",
      "nextStep": "Retry this file." }
  ]
}
```

Called **after** the browser's direct `PUT`s land — batched, or one file
at a time; both are fine because it is idempotent per `fileId`.

`fileLocation` is the client's own path for the file: `webkitRelativePath`
for a folder drop, the plain name otherwise. It exists so the UI can
group rows under the folder they came from and so a support question
names something real. **The server must never attempt to read it** — it
is a path on somebody else's machine.

Per file, the server does §20's work: HEAD the object, store
`generation`, `checksum` and the true `size_bytes`, advance
`UPLOADING → UPLOADED`, and write the outbox row for the inspect topic in
the same transaction (§24). A `fileId` whose object is not actually in
the bucket settles as an `acquisition` failure on that row — never a
`500`, and never a silent success.

**Never mark a file uploaded because `/api/getSignedUrl` returned
successfully.** Handing out a signed URL says nothing about whether
anything was written to it.

------------------------------------------------------------------------

## 0.4 `POST /api/polling/schema`

``` json
// request
{
  "userId": "usr_9f3a…",
  "requestId": "req_01KABC",
  "received": ["file_7a2", "file_7a3"]
}

// response
{
  "userId": "usr_9f3a…",
  "requestId": "req_01KABC",

  // required additions — the gate is unimplementable without them
  "pending": 7,
  "convertAvailable": false,
  "convertBlockedReason": "7 files are still reading their shape.",

  "files": [
    {
      "fileId": "file_7a4",
      "fileName": "invoice-1045.pdf",
      "filePath": "requests/req_01KABC/input/file_7a4-invoice-1045.pdf",
      "schemaId": "sch_31",
      "status": "ready",
      "schema": {
        "tableOrd": 0,
        "tableLabel": "table 1",
        "version": 1,
        "shapeHash": "9c1f…",
        "matchingFileCount": 37,
        "fields": [
          { "key": "invoice_number", "label": "invoice_number", "type": "text",   "origin": "detected" },
          { "key": "invoice_date",   "label": "invoice_date",   "type": "date",   "origin": "detected" },
          { "key": "total",          "label": "total",          "type": "number", "origin": "detected" }
        ]
      }
    },
    {
      "fileId": "file_7b1",
      "fileName": "scan-0091.pdf",
      "filePath": "requests/req_01KABC/input/file_7b1-scan-0091.pdf",
      "schemaId": null,
      "status": "failed",
      "schema": null,
      "failure": {
        "class": "extract_empty",
        "message": "Its pages are images with no readable text.",
        "nextStep": "Remove it, or convert it anyway and it will be skipped."
      }
    }
  ]
}
```

**Delta poll.** `received` is the set of `fileId`s the client already
holds; the server returns only files not in it.

**A multi-table file appears once per table** — same `fileId`, different
`schemaId`. The array is keyed by `(fileId, schemaId)`, which is how a
spreadsheet with three differing sheets becomes three editable shapes
(D27). For `received` to stay correct when it is keyed on `fileId` alone,
**the inspect worker must write all of a file's schemas in one
transaction.** All-or-nothing per file; a partially-written file would
have its later tables permanently filtered out by the client's dedupe.

`status` and `failure` are the additions that are **not negotiable**.
Without them a file that can never produce a shape is indistinguishable
from one still working, the client waits forever, and the Convert gate —
*settled means ready **or** failed* (§12, §22) — cannot be evaluated at
all. One unreadable file would hold fifty good ones hostage, which is the
exact behaviour the design exists to prevent.

`matchingFileCount` is resolved server-side from `shape_hash` over
`original_fields`, so the Apply-to-all control can put the count in its
own label without a second call.

**Cadence:** every 2 s while `pending > 0`; back off to 5 s after 60 s;
stop when `pending` reaches 0. A file's entry is returned once and never
resent, so a client that misses one recovers by clearing `received`.

------------------------------------------------------------------------

## 0.5 `POST /api/updateSchema`

``` json
// request — one entry per (fileId, schemaId) the save touches
{
  "userId": "usr_9f3a…",
  "requestId": "req_01KABC",
  "files": [
    { "fileId": "file_7a4", "fileName": "invoice-1045.pdf", "filePath": "…",
      "schemaId": "sch_31", "schema": { "fields": [ … ] } },
    { "fileId": "file_7a5", "fileName": "invoice-1046.pdf", "filePath": "…",
      "schemaId": "sch_32", "schema": { "fields": [ … ] } }
  ]
}

// response — required addition: the new versions
{ "status": "ok", "updated": [ { "schemaId": "sch_31", "version": 2 },
                               { "schemaId": "sch_32", "version": 2 } ] }
```

**Apply-to-all is expressed as several entries in one call.** The client
already holds every schema's original shape, so it resolves the scope
itself and sends the edited field list against each affected
`(fileId, schemaId)`. That is D29's *"the save carries the schema and its
scope"* — the scope simply *is* the list, so the server never has to
reconstruct what the user meant.

The server still validates, and still owns the rules (§25.3):

-   **Exactly two edits exist** — change a field's `type`, add a field.
    A payload that renames or removes a field is rejected `409`, compared
    against `original_fields`. Enforced server-side rather than trusting
    the UI not to send one.
-   Every entry's `original_fields` hash must equal the edited schema's.
    If one does not, **the whole call is rejected** — never a partial
    apply.
-   Each affected row bumps `version` and sets `edited_at`.
-   After Convert this returns `409`. Schemas freeze at the gate (§22).

------------------------------------------------------------------------

## 0.6 `POST /api/convert`

``` json
// request
{ "userId": "usr_9f3a…", "requestId": "req_01KABC" }

// response
{ "status": "received", "queued": 38, "skipped": 2 }
```

The one gate. §22 is unchanged: the server **re-checks the gate itself**
rather than trusting a greyed-out button, moves every `SCHEMA_READY` file
to `CONVERTING`, and writes one outbox row per file to the convert topic.

Gate not met → `409`:

``` json
{ "failureClass": "gate_not_met",
  "message": "7 files are still reading their shape.",
  "nextStep": "Wait for them to finish, or remove them.",
  "pending": 7 }
```

Idempotent: a second call while the request is already `CONVERTING`
returns `received` with the same counts, not an error. `skipped` counts
files already `FAILED` — carried through as failures, never blockers.

------------------------------------------------------------------------

## 0.7 `POST /api/polling/result`

``` json
// request
{ "userId": "usr_9f3a…", "requestId": "req_01KABC" }

// response
{
  "userId": "usr_9f3a…",
  "requestId": "req_01KABC",

  // required additions — the processing screen is blank without them
  "status": "CONVERTING",
  "pausedUntil": null,
  "counts": { "queued": 19, "extracting": 1, "filling": 1, "done": 18, "failed": 2 },
  "rowsSoFar": 4912,
  "estimatedSecondsRemaining": 840,
  "allowance": { "used": 4110, "limit": 5000, "resetsAt": "2026-09-15T00:00:00Z" },

  "files": [
    { "fileId": "file_7a2", "fileName": "invoice-1043.pdf", "schemaId": "sch_31",
      "stage": "DONE", "rowCount": 14, "fieldCount": 6, "toCheckCount": 0 },

    { "fileId": "file_7a3", "fileName": "invoice-1044.pdf", "schemaId": "sch_32",
      "stage": "DONE", "rowCount": 22, "fieldCount": 6, "toCheckCount": 3 },

    { "fileId": "file_7c1", "fileName": "invoice-1061.pdf", "schemaId": "sch_57",
      "stage": "EXTRACTING", "progress": { "unit": "page", "at": 2, "of": 3 },
      "rowCount": 11 },

    { "fileId": "file_7d0", "fileName": "invoice-1070.pdf", "schemaId": "sch_66",
      "stage": "FAILED", "rowCount": 0,
      "failure": { "class": "format_locked",
                   "message": "Password-protected, so its pages can't be opened.",
                   "nextStep": "Remove the password and upload it again." } }
  ]
}
```

`stage` is one of `QUEUED · EXTRACTING · FILLING · DONE · FAILED`, and the
five `counts` must always sum to the number of tables in the request —
failures included. The processing screen renders those counts as the
pipeline itself, so a count that does not add up is visible immediately
as a stage that has lost a table.

Every entry is returned on every poll (this endpoint is a snapshot, not a
delta — unlike §0.4). A table with `stage: "DONE"` is openable and
downloadable **from that moment**, which is the per-file streaming
promise (D30) expressed in one field.

**Cadence:** every 2 s while `status` is `CONVERTING`; every 30 s while
`PAUSED`, until `pausedUntil`; stop at `COMPLETED` or `FAILED`.
`PAUSED` is not an error and must never be rendered as one.

------------------------------------------------------------------------

## 0.8 Additions this contract needs, and why

The seven routes and their named fields are fixed. These are additive
fields inside them, agreed with the frontend because a screen in the
design cannot be built without them. Each one is a field, not a route.

| # | Where | Addition | What breaks without it |
|---|---|---|---|
| A1 | §0.2 | `uploadHeaders`, `expiresAt` | Every upload `403`s, and reports itself as a CORS error (§19.1) |
| A2 | §0.3 | per-file `stage` / `failureClass` in the response | "Upload didn't finish — retry this file" cannot be shown |
| A3 | §0.4 | `status`, `failure` per entry | **The Convert gate cannot be evaluated.** One bad file blocks the batch forever |
| A4 | §0.4 | `pending`, `convertAvailable`, `convertBlockedReason` | The disabled Convert button cannot say what would enable it |
| A5 | §0.4 | `shapeHash`, `matchingFileCount` | Apply-to-all cannot carry its count, which is the whole feature |
| A6 | §0.5 | `updated[].version` | The client cannot reconcile versions without re-polling |
| A7 | §0.7 | `stage`, `counts`, `rowCount`, `toCheckCount`, `failure` | The pipeline strip and every per-row state on S04 are blank |
| A8 | §0.7 | `status`, `pausedUntil`, `allowance` | "Paused until 14:32" renders as a stall or as an error |

**A3 is the one that is not negotiable.** The rest degrade a screen; A3
makes the product's central rule — *settled means ready or failed* —
impossible to implement on the client at all.

## 0.9 Not in the contract yet

These have no route, and the frontend builds them behind the same typed
interface against fixtures until they do (see
[`development-plan.md`](development-plan.md) §2). Nothing about the
screens changes when they arrive; one module is swapped.

| Surface | Needed for | Interim |
|---|---|---|
| List a user's requests | S01 workspace batch list | The client keeps its own list in `localStorage` |
| Table rows | S06 | Fixtures |
| Evidence for one value | S06's evidence panel | Fixtures |
| Raw text for one table | The design's replacement for the machine view | Fixtures |
| Download a table / the batch | S08 | Client-side CSV from rows already held |
| Merge | S09 | Fixtures; the shape is already specified in §25.5 |

## 0.10 Where the older sections still apply

| Older section | Route it named | Now | Still authoritative for |
|---|---|---|---|
| §12.1 | `/api/auth/*` | **§0.1** | — (replaced; no passwords) |
| §12.2, §12.3 | — | unchanged | The cookie, and "the body is a claim, the cookie is the authority" |
| §16, §17 | `/api/getSignedUrl` | **§0.2** | Validation, caps, the object key |
| §18 | — | **§0.2** | Rejected files travel in the same array |
| §19.1 | — | unchanged | The headers contract |
| §19.2 | — | **superseded** | `.zip` is rejected client-side with a reason, not expanded (matches the design). Browser expansion is the named upgrade path |
| §20 | `/api/files/:id/uploaded` | **§0.3** | HEAD-verify, generation, checksum, outbox |
| §21 | `GET /api/requests/:id` | **§0.7** | `convertAvailable` is computed by the server |
| §22 | `POST …/convert` | **§0.6** | The whole gate transaction |
| §25.1, §25.2 | `GET …/schemas` | **§0.4** | `matchingSchemaIds`, empty-schemas-is-200-not-404 |
| §25.3 | `POST /api/updateSchema` | **§0.5** | The two-edits rule and scope validation |
| §25.4 | SSE | **removed** | `file_events` remains as the audit trail |
| §25.5 | `POST /api/merges` | not yet exposed | The exact-match check and the conflict shape |
| §25.6 | rows | not yet exposed | `state` is decided by the server, never re-derived by the UI |

------------------------------------------------------------------------

# 1. Objective

Build a complete working backend foundation around the existing Next.js
frontend.

At the end of this implementation, this exact flow must work:

``` text
Browser  — first visit
   |  POST /api/register  { userId }  ->  signed session cookie   §0.1
   v
Browser  — drop files (a .zip is rejected here, with a reason)
   |  POST /api/getSignedUrl   { userId, requestId, files[] }     §0.2
   v
Next.js API on Vercel
   |  create request + file rows, one signed upload URL per file
   v
Browser
   |  direct PUT each file's bytes
   v
Google Cloud Storage
   |
   v
Browser
   |  POST /api/upload   { userId, requestId, files[] }           §0.3
   v
Next.js API on Vercel
   |  verify each object, stage = UPLOADED
   |  outbox row  ->  <prefix>-file-uploaded
   v
Google Pub/Sub  —  authenticated push
   v
+-----------------------------+
| Cloud Run:  INSPECT WORKER  |   hello-world for now
|  reads the file             |
|  writes file_schemas        |   all of a file's tables in ONE txn
|  stage = SCHEMA_READY       |
+-----------------------------+
   |
   v
Browser  —  POST /api/polling/schema  { received[] }  every 2s    §0.4
   |         the user sees each shape as it lands
   |  ...corrects it...
   v
Browser  —  POST /api/updateSchema    { files[] }                 §0.5
   |         one call carries the edit AND its apply-to-all scope
   v
Browser  —  POST /api/convert         { userId, requestId }       §0.6
   v                                                    <-- THE GATE
Next.js API on Vercel
   |  outbox row per file  ->  <prefix>-convert-requested
   v
Google Pub/Sub  —  authenticated push
   v
+-----------------------------+
| Cloud Run:  CONVERT WORKER  |
|  reads input from GCS       |
|  writes output to GCS       |
|  stage = COMPLETED          |
+-----------------------------+
   |
   v
Browser  —  POST /api/polling/result  every 2s                    §0.7
             each table becomes openable the moment it is DONE
   v
requests/<requestId>/output/<fileId>/result.txt

Successfully processed <original filename>
```

**Both workers are intentionally trivial in this phase.** The inspect
worker writes a fixed placeholder schema; the convert worker writes one
line of text. What is real is the *shape*: two triggers, two services,
the gate between them, and a database the UI can read a schema out of.

The purpose of this phase is to prove that:

-   a user can register a browser-generated id and have everything they
    do attributed to it, with no sign-up step (§0.1);
-   the browser can expand an archive and upload each member directly to
    GCS;
-   PostgreSQL persists the request, its files and their stages;
-   an upload publishes to Pub/Sub **transactionally** (§24);
-   Pub/Sub can securely invoke **two separate** Cloud Run services;
-   the inspect worker can write a schema the UI can then fetch;
-   **the Convert gate holds** — nothing processes until the user presses
    it;
-   the convert worker can read from GCS, write to GCS, and finish;
-   a crashed worker's file is reclaimed and finishes anyway (§31);
-   every failure carries a class and a sentence (§12.4);
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

## Two services, because the Convert gate splits the work

There are **two** Cloud Run services, not one (§26):

``` text
file finishes uploading   ->  <prefix>-file-uploaded      ->  inspect-worker
user presses Convert      ->  <prefix>-convert-requested  ->  convert-worker
```

The inspect worker runs on upload for every file and writes that file's
schema, so the user can see the shape before committing to anything. The
convert worker runs only after the user approves those shapes.

They are separate services because the two halves fail, scale and cost
differently: inspection is short and unconditional, conversion is long
and expensive, and a crash loop in conversion must not stop new uploads
from being inspected. They share one image; `SERVICE_ROLE` selects the
processor.

**Both are intentionally trivial in this phase** — the inspect worker
writes a fixed placeholder schema, the convert worker writes a text file.
The point is that the boundary, the contract and the storage layout are
real, so the next phase replaces two files and nothing else.

## A third entry point: the scheduled sweep

Both services also accept `POST /internal/sweep`, invoked by Cloud
Scheduler on a one-minute interval (§24.3).

``` text
Pub/Sub          ->  POST /                 fast path, per file
Cloud Scheduler  ->  POST /internal/sweep   recovery path, on a timer
```

The push path carries the normal case; the timer path makes the system
self-healing when the push path does not fire — a publish that failed, a
worker that died holding a file, or a request parked on a limit waiting
for its resume time. **Neither path is optional**, and the timer path is
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
-   **`fflate`** (or JSZip) — expands a dropped `.zip` in the browser so
    each member uploads as its own file (§19.2)

The exact versions MUST be determined from the existing repository.

## Database

-   PostgreSQL
-   Google Cloud SQL for PostgreSQL
-   Prisma ORM unless the repository already has an established
    ORM/database layer that should be retained

**One tool owns the schema.** Prisma owns migrations and the Next.js
side; the Python worker uses SQLAlchemy Core to **read and write, never
to migrate**, and never autogenerates anything. Two migration tools
pointed at one database is the standard way to lose a column — each
derives "what the schema should be" from models in its own language, so
a column added by one looks like drift to the other. Write this down in
the worker's README, because nothing enforces it at runtime.

## Authentication

-   A **browser-generated user id**, registered once (§0.1). No
    username, no password, no OAuth, no email, no roles
-   A signed httpOnly session cookie, HMAC-SHA256 over that user id
-   Nothing to hash, because nothing secret is ever submitted

See §0.1 and §12.1–§12.3. The id is a bearer capability, so its
**entropy is the security control** and the server enforces it. There is
no password shortcut to get wrong here because there is no password.

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
├── Pub/Sub topic          <prefix>-file-uploaded
│   ├── push subscription  → inspect-worker, dead-letter policy
│   ├── dead-letter topic
│   └── dead-letter subscription (pull, for inspection)
│
├── Pub/Sub topic          <prefix>-convert-requested
│   ├── push subscription  → convert-worker, dead-letter policy
│   ├── dead-letter topic
│   └── dead-letter subscription (pull, for inspection)
│
├── Artifact Registry Docker repository
│
├── Cloud Run service      <prefix>-inspect-worker    (§26)
│
├── Cloud Run service      <prefix>-convert-worker    (§26)
│
├── Cloud Scheduler job    →  POST /internal/sweep    (§24.3)
│
├── Vercel service account
│
├── inspect-worker service account
│
├── convert-worker service account
│
├── Pub/Sub invoker service account
│
├── Scheduler invoker service account
│
└── Workload Identity Federation resources
```

**Two topics and two Cloud Run services**, because the Convert gate
splits the pipeline into two kinds of work that fail, scale and cost
differently (§26). They share one container image and one Artifact
Registry repository; `SERVICE_ROLE` selects the processor.

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
    one signed into the URL.** If `/api/getSignedUrl` signs
    `text/plain` and the browser sends `text/plain;charset=utf-8`, GCS
    returns `403 SignatureDoesNotMatch`. Because the response carries no
    CORS headers, the browser reports it as a **CORS error**, which sends
    people to fix the wrong thing. The frontend must send exactly the
    `headers` object returned by `/api/getSignedUrl` (§18) and must not
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

The vocabulary matches the Request POJO the frontend sends: a **user**
makes a **request**, a request carries **files**, and each file gets a
**schema**.

``` text
users ──< requests ──< files ──< file_schemas
               │         │
               │         └──< file_events
               └──< request_outbox
```

`jobs` and `job_files` from earlier drafts are gone. A file row *is* the
unit of work — it carries its own stage, its own lease and its own
failure. A second table tracking the same thing is a second thing to
keep in step.

------------------------------------------------------------------------

## users

``` text
id                 -- the browser-generated client id, stamped on everything below
created_at
updated_at
last_seen_at
```

Minimal on purpose: an id, and two timestamps. No username, no password,
no email, no roles, no OAuth. **The id is the only part the rest of the
system cares about** — it is what groups everything a person owns.

------------------------------------------------------------------------

## 12.1 Registration — one endpoint, no password

Superseded the four `/api/auth/*` endpoints. The full contract is §0.1;
this is what it means for the database.

``` text
POST /api/register   { userId }  -> 200, sets the sid cookie, { status: "ok" }
```

Rules:

-   `userId` is generated **in the browser** with `crypto.randomUUID()`
    or 16 bytes of `crypto.getRandomValues`, and kept in `localStorage`.
    The server validates `[A-Za-z0-9_-]{22,64}` and rejects anything
    else with `400`.
-   **`INSERT … ON CONFLICT (id) DO UPDATE SET last_seen_at = now()`.**
    Registering an id that already exists is a success, not a collision:
    it is how the same person reaches their workspace from a second
    browser.
-   That makes the id a **bearer capability** — whoever has it has the
    workspace. There is no second factor and there cannot be one without
    a sign-up step, which is a graded property of this product (D2). The
    entropy requirement above is the whole defence, so it is enforced
    server-side and not merely assumed of the client.
-   The UI must describe the workspace honestly — *"this workspace lives
    in this browser"* — rather than implying a private account.
-   Rate-limit registrations per IP. A fixed window in PostgreSQL is
    enough; this does not need Redis.

## 12.2 The session

A **signed, httpOnly cookie holding the user id**:

``` text
name        sid
value       <userId>.<HMAC-SHA256(userId, SESSION_SECRET)>
httpOnly    true        -- browser JavaScript can never read it
secure      true        -- in every deployed environment
sameSite    lax
path        /
maxAge      30 days
```

A signed cookie is enough and a JWT is not needed: one service issues it
and the same service reads it. There is no third party to convince.

`SESSION_SECRET` lives in Secret Manager and in Vercel's environment
variables. Rotating it logs everyone out, which is the correct and
acceptable behaviour.

## 12.3 Resolving the current user

**The client is never the authority on who it is.**

`userId` appears in the body of all seven endpoints (§0) — the frontend
has it, and a self-describing payload is easier to log and to debug. But
the server takes identity from the **cookie**, and treats the body field
as a claim to be checked:

``` text
resolveUser(request):

  1. valid signed sid cookie      -> that user            (the real path)

  2. ALLOW_DEV_USER=true
     AND DEV_USER_ID is set       -> that user            (local dev only)

  3. neither                      -> 401 UNAUTHENTICATED
```

``` text
if (body.userId && body.userId !== resolved.id)
    -> 403 FILE_ACCESS_DENIED
```

The one exception is `POST /api/register` itself, which runs before a
cookie exists and whose whole job is to establish one.

Checked against the cookie, never trusted instead of it. Without that
rule, every "verify this belongs to the user" check downstream verifies a
value the caller picked, and changing one field reads somebody else's
documents.

`ALLOW_DEV_USER` must be absent in every deployed environment, and the
server must refuse to start if it is true while
`NODE_ENV === "production"`. A flag that disables authorization has to
fail loudly, because its failure mode is invisible — everything works,
for everyone, on everyone's data.

Resolve in **one** function that every route handler calls. An
authorization check that is re-implemented per route is one that will be
forgotten on a route.

------------------------------------------------------------------------

## requests

One submission. The user drops a folder, a request is created, and every
file in that drop belongs to it. `requestId` in the POJO is this row's
id.

``` text
id                 -- the requestId carried in every payload and log line
user_id

status
format             -- the declared format of the drop, from the POJO
file_count

created_at
updated_at
converted_at       -- when Convert was pressed; NULL before that
paused_until       -- set when a limit is hit; NULL otherwise
error_code
```

Request status:

``` text
COLLECTING     files still uploading, or their schemas still being read
READY          every file has settled a schema; Convert is now available
CONVERTING     Convert was pressed; the second worker is running
PAUSED         stopped on a limit, will resume by itself
COMPLETED
FAILED
```

**`PAUSED` is not an error.** Running out of a daily model allowance is
routine, is nobody's fault, and loses nothing already done — so it
carries a `paused_until` time and resumes on its own. A system that
renders its normal state as a red error teaches people to ignore red
errors.

**`READY` is the Convert gate**, and it is a question about the whole
request rather than a stage of its own:

``` text
READY  ⇔  every file in the request has stage
          SCHEMA_READY  or  FAILED
```

"Settled" means ready **or** failed. One unreadable file must not hold
fifty good ones hostage.

------------------------------------------------------------------------

## files

``` text
id
request_id
user_id                 -- denormalised; nearly every query starts here

original_filename
content_type            -- what the client declared
detected_content_type   -- what the bytes actually are; NULL until detect
size_bytes

bucket
object_key
generation
checksum

zip_parent_name         -- NULL, or the archive this file came out of (§19.2)

stage
attempts
max_attempts
claimed_by
claimed_until

failure_class           -- NULL unless stage = FAILED  (§12.4)
failure_detail

created_at
uploaded_at
updated_at
deleted_at
```

### The stage column

One column carries the whole life of a file, and the Convert gate sits
in the middle of it:

``` text
UPLOADING → UPLOADED → INSPECTING → SCHEMA_READY ──┬──→ CONVERTING → COMPLETED
                                                    │
                        ▲ worker 1 (§26)            │      ▲ worker 2 (§26)
                                          user presses Convert

                                FAILED   ← reachable from any stage
```

Everything left of the gate is free and commits the user to nothing.
Everything right of it costs money. A file parks at `SCHEMA_READY` for
as long as the user takes — crash, redeploy, close the tab, come back
tomorrow, and the row still says `SCHEMA_READY`, so "the request waited
two days and then carried on" needs no special handling at all.

### Lease columns

`claimed_by` and `claimed_until` are a lease (§31). A worker takes a file
by writing its own instance id and a future timestamp; a worker that dies
without releasing the claim has the file reclaimed when the lease
expires. Crash recovery with no second system.

Indexes:

``` text
files (request_id)
files (user_id, created_at DESC)
files (stage, claimed_until)      -- the reaper's only query
```

------------------------------------------------------------------------

## file_schemas

Written by the **inspect** worker (§26). Read by the UI before Convert.

A file holding several tables produces several rows — a spreadsheet with
three differently-shaped sheets gets three, edited separately.

``` text
id
file_id
table_ord               -- 0, 1, 2 … within the file
table_label             -- "Sheet 1", "Table on page 4"
version                 -- bumped on every user edit

fields         jsonb    -- the current shape, after any edits
original_fields jsonb   -- the shape as first detected — never modified
shape_hash              -- hash of original_fields, normalised, order-independent

edited_at
created_at
```

A field inside `fields`:

``` json
{
  "key": "invoice_no",
  "label": "Invoice No",
  "type": "text",
  "required": true,
  "origin": "detected"
}
```

`type` is one of `text · number · date · currency · boolean · list`.
`origin` is `detected` or `added_by_user`.

Two columns are worth defending:

-   **`original_fields` is never modified.** It is what "apply this to
    every file that originally looked like this one" matches against.
    Matching on the current shape instead would make the affected set
    depend on the order the user made their edits in, which is
    impossible to explain and impossible to predict.
-   **`shape_hash`** is that same original shape reduced to one indexed
    value, so "which other files started out looking like this" is a
    lookup rather than a scan across the request.

------------------------------------------------------------------------

## file_events

``` text
id                 -- also the cursor the live update stream replays from
request_id
file_id            -- NULL for request-level events
user_id            -- denormalised
request_trace_id   -- the API request that caused this  (§12.5)
event_type
message
metadata  jsonb
created_at
```

At minimum, emit:

``` text
REQUEST_CREATED        UPLOAD_INITIALIZED     UPLOAD_CONFIRMED
ZIP_EXPANDED           INSPECT_STARTED        SCHEMA_WRITTEN
SCHEMA_UPDATED         CONVERT_REQUESTED      CONVERT_STARTED
OUTPUT_WRITTEN         FILE_COMPLETED         FILE_FAILED
FILE_RECLAIMED         REQUEST_PAUSED         REQUEST_COMPLETED
```

`user_id` and `request_trace_id` are duplicated here deliberately. Both
are reachable by join, but every question worth asking of this table
starts with "what happened for this person" or "what did this one click
cause", and neither should need one.

------------------------------------------------------------------------

## request_outbox

The transactional outbox (§24), written in the same transaction as the
thing it announces.

``` text
id
request_id
file_id            -- NULL for request-level messages
topic              -- which of the two topics this goes to  (§23)
payload   jsonb
status             -- PENDING | PUBLISHED | DEAD
attempts
next_attempt_at
last_error
published_at
created_at
updated_at
```

Index: `request_outbox (status, next_attempt_at)` — the relay's only
query.

------------------------------------------------------------------------

## 12.4 Failure classes

Every failure gets a **class from a closed list**, a sentence a person
can act on, and a defined next step. No unclassified error ever reaches
the UI, and no screen ever prints a raw exception message.

`files.failure_class` and every error response carry one of these:

| Class | What went wrong | What the user reads | Retryable |
|---|---|---|---|
| `upload_incomplete` | Upload aborted, or the object is missing | "Upload didn't finish. Try this file again." | yes |
| `file_empty` | Zero bytes | "This file is empty." | no |
| `too_large` | Over the size cap | "This file is 82 MB. The limit is 50 MB." | no |
| `format_unsupported` | No handler for this type | "`.dwg` isn't supported. Supported types are …" | no |
| `format_corrupt` | The bytes are not the declared type | "This file says `.pdf` but is actually a ZIP archive." | no |
| `format_locked` | Password-protected | "This PDF is password protected. Remove the password and upload it again." | no |
| `zip_expand_failed` | The archive could not be opened | "This archive couldn't be opened. Try re-creating it." | no |
| `zip_empty` | The archive held no usable files | "This archive is empty." | no |
| `schema_not_found` | Read fine, but nothing table-shaped in it | "Couldn't find a table in this one. Leave it out, or add fields yourself." | no |
| `schema_read_failed` | The inspect worker failed | "Couldn't work out this file's shape. Convert anyway and it'll be skipped." | yes |
| `gate_not_met` | Convert pressed too early | "12 files are still reading their shape." | n/a |
| `merge_incompatible` | Selected tables disagree | "`Invoice No` is text in 12 tables and number in 3." | n/a |
| `processing_failed` | The convert worker failed | "Something went wrong processing this file. Try it again." | yes |
| `quota_exhausted` | Daily allowance spent | "Daily limit reached. Picking up again at 14:32." | auto |
| `max_attempts` | Retried to exhaustion | "This file failed repeatedly and has been stopped." | no |
| `internal` | Genuinely unexpected | "Something went wrong. We've logged it." | yes |

Three rules make this structural rather than a convention people
remember:

1.  **Retryable classes are retried; non-retryable classes dead-letter
    immediately.** Retrying a password-protected PDF four times burns
    quota to reach the same answer.
2.  **`quota_exhausted` is not a failure.** It pauses the request with a
    `paused_until` and the sweep resumes it. It never marks a file
    `FAILED`.
3.  **One place turns a class into text.** The mapping from class to
    sentence lives in a single module on the frontend and a single
    module in the worker. If a screen renders `error.message` directly,
    that is a bug regardless of how good the message happens to read.

Every API error response uses one shape, everywhere:

``` json
{
  "failureClass": "too_large",
  "message": "This file is 82 MB. The limit is 50 MB.",
  "nextStep": "Split the file, or remove it and carry on.",
  "requestTraceId": "req_8f1c"
}
```

## 12.5 Correlating a user to a request

Every API call gets a `requestTraceId`, generated on entry or taken from
an inbound `X-Request-Id`. It is distinct from `requestId`, which is the
user's submission — one submission produces many traces.

``` text
API call                requestTraceId generated
   |
   +--> every API log line         { requestTraceId, userId, requestId, fileId }
   +--> file_events.request_trace_id
   +--> Pub/Sub message attribute
            |
            v
      worker log lines             { requestTraceId, userId, fileId }
```

Bind both to the log context **once**, at the entry point, so every later
line carries them without anyone having to remember. A field passed by
hand into each log call is the field missing from the one line you need.

Both of these then become single filters rather than investigations:

``` text
requestTraceId = "req_8f1c"      everything one click caused, across both services
userId         = "usr_1a2b"      everything this person has ever done
```

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
packages/web/src/app/api/register/route.ts          §0.1
packages/web/src/app/api/getSignedUrl/route.ts      §0.2
packages/web/src/app/api/upload/route.ts            §0.3
packages/web/src/app/api/polling/schema/route.ts    §0.4
packages/web/src/app/api/updateSchema/route.ts      §0.5
packages/web/src/app/api/convert/route.ts           §0.6
packages/web/src/app/api/polling/result/route.ts    §0.7
packages/web/src/app/api/merges/route.ts            §25.5 — not exposed yet
```

Seven routes and one placeholder. Every one is `POST`. There is no
`events` route: the browser polls (§25.4).

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

# 16. API: POST /api/getSignedUrl

> **Route and payload are now §0.2.** Everything below — the
> idempotency of a client-generated `requestId`, the caps, the
> per-file-rejection rule — still applies, with `userId` read as
> `userId` and the per-file objects reduced to plain filenames.

## Purpose

Create a request and hand back one signed upload URL per file.

This is **batch-shaped**, not one call per file. The frontend has the
whole drop in hand, so one round trip creates the request row and every
file row together, inside one transaction.

## The Request POJO

``` json
{
  "userId": "usr_1a2b",
  "requestId": "req_01KABC",
  "format": "mixed",
  "files": [
    { "filename": "invoice-204.pdf", "contentType": "application/pdf", "size": 84213 },
    { "filename": "invoice-205.pdf", "contentType": "application/pdf", "size": 91044 }
  ]
}
```

| Field | Meaning |
|---|---|
| `userId` | The user id. **Checked against the session cookie, never trusted instead of it** (§12.3) |
| `requestId` | Client-generated id for this submission, so a retried call is not a second request |
| `format` | The declared format of the drop — `pdf`, `csv`, `xlsx`, `mixed` |
| `files` | One entry per file, **after any archive has been expanded** (§19.2) |

`requestId` being client-generated makes this call **idempotent**: the
same `requestId` twice returns the same request and the same file rows
rather than creating a duplicate. A dropped response on a flaky
connection is then harmless.

## Validate

Per request:

-   `userId` matches the session → otherwise `403`;
-   `requestId` is a sane id, 8–64 characters of `[A-Za-z0-9_-]`;
-   `files` is non-empty and within the per-request count cap;
-   total declared size is within the per-request byte cap.

Per file:

-   `filename` present, non-empty, within the length cap;
-   `contentType` present and on the allow-list;
-   `size` positive and below `MAX_UPLOAD_BYTES`.

A rejected **file** does not reject the request. Valid files get URLs;
invalid ones come back with a failure class and no URL, and the frontend
shows the reason on that row while the rest carry on.

**Do not trust the extension — and do not trust `contentType` either.**
Both come from the client. The allow-list here is a cheap first filter;
the real check is the inspect worker sniffing magic bytes and setting
`detected_content_type`, which is what raises `format_corrupt`.

------------------------------------------------------------------------

# 17. Upload Object Key

The backend generates the storage path. The client never chooses a GCS
object key.

``` text
requests/<requestId>/input/<fileId>-<safe-filename>
requests/<requestId>/output/<fileId>/result.txt
```

Example:

``` text
requests/req_01KABC/input/file_7a2-invoice-204.pdf
requests/req_01KABC/output/file_7a2/result.txt
```

Input and output share the `requests/<requestId>/` prefix, so one
request is one prefix — which is what makes lifecycle rules, IAM prefix
conditions and cleanup expressible at all.

`<safe-filename>` is the original name with path separators, control
characters and leading dots stripped, truncated to 100 characters. The
`<fileId>-` prefix guarantees uniqueness, so two files with the same
name in one drop never collide.

------------------------------------------------------------------------

# 18. Upload API Response

> **Shape is now §0.2.** The field below called `objectKey` plus
> `upload.url` is what §0.2 flattens into `filePath` +
> `uploadHeaders` + `expiresAt`. The rule that matters is unchanged:
> rejected files come back **in the same array**, with a failure class
> and no upload capability, so nothing disappears silently between what
> was dropped and what comes back.

``` json
{
  "requestId": "req_01KABC",
  "status": "COLLECTING",
  "files": [
    {
      "fileId": "file_7a2",
      "filename": "invoice-204.pdf",
      "objectKey": "requests/req_01KABC/input/file_7a2-invoice-204.pdf",
      "stage": "UPLOADING",
      "upload": {
        "method": "PUT",
        "url": "<signed-url>",
        "headers": { "Content-Type": "application/pdf" },
        "expiresAt": "2026-09-14T11:05:00Z"
      }
    },
    {
      "fileId": "file_7a3",
      "filename": "notes.dwg",
      "stage": "FAILED",
      "failureClass": "format_unsupported",
      "message": "`.dwg` isn't supported.",
      "nextStep": "Remove it, or convert it to PDF first."
    }
  ]
}
```

Rejected files appear in the same array with a failure class and no
`upload` block. One shape to render, and nothing silently disappears
between what was dropped and what comes back.

Never return private GCP credentials. The signed URL is the only
capability that crosses this boundary.

------------------------------------------------------------------------

# 19. Browser Upload

``` text
POST /api/getSignedUrl
        |
        v
one signed URL per accepted file
        |
        v
OPTIONS preflight  ->  answered from the bucket's CORS config (§9.1)
   (automatic)
        |
        v
PUT each file directly to GCS, in parallel, with a concurrency cap
        |
        v
POST /api/upload    per file, as each one lands
```

## 19.1 The headers contract

The `PUT` must send **exactly** the `headers` object returned by
`/api/getSignedUrl` — no more, no fewer, and nothing the client invented.
The signature covers those headers; any difference is a different request
and GCS answers `403 SignatureDoesNotMatch`.

``` ts
await fetch(file.upload.url, {
  method: file.upload.method,     // 'PUT'
  headers: file.upload.headers,   // verbatim — do not spread, do not add
  body: blob,
})
```

Two ways this goes wrong, both of which appear in the console as a **CORS
error** rather than the signature problem they are:

1.  **A Content-Type the client chose.** Passing `body: blob` with no
    explicit header lets the browser infer one from the blob, which is
    often `text/plain;charset=utf-8` where the server signed
    `text/plain`. Always set the header from the response.
2.  **Extra headers.** `Authorization`, or anything a fetch wrapper adds
    by default. Use a bare `fetch` — **this request goes to Google, not
    to our API, and must not carry our session cookie.**

See §43.1 before changing any CORS configuration in response to this.

## 19.2 Archives — rejected now, expanded later

**A `.zip` is rejected client-side, on its own row, with a reason:**
*"q3-archive.zip — unzip it first."* That is what the design shows, it
costs no backend surface, and it is honest at the first step rather than
after a 200 MB transfer.

**Browser expansion is the named upgrade path**, specified below and
already accommodated by the `zip_parent_name` column, so picking it up
later touches the client and one column — not the contract. The rest of
this section is that design, kept because it is cheaper to keep than to
rediscover.

**If the user drops a `.zip`, the frontend expands it and uploads each
member as its own file.** The archive itself is never uploaded.

``` text
user drops  invoices.zip
        |
        v
expand in the browser  (fflate, or JSZip)
        |
        v
40 entries
        |
        +-- skip directories, __MACOSX/, .DS_Store, and dot-files
        +-- skip nested archives, with a reason on the row
        +-- each survivor becomes one entry in the POJO's `files` array,
            carrying zipParentName: "invoices.zip"
        |
        v
POST /api/getSignedUrl   with 40 files, not 1
```

Why in the browser rather than in a worker:

-   Every member gets its **own** file row, own progress bar, own
    failure and own retry — which is what the upload screen renders
    anyway. Expanding server-side would give one row that silently
    becomes forty.
-   The upload path stays a single shape. There is no "sometimes a file
    is an archive" branch in the backend, no expand stage, and no
    partially-expanded archive to recover.
-   A corrupt archive fails **before** anything is uploaded, so the user
    finds out immediately instead of after a 200 MB transfer.

Limits, enforced client-side before the POJO is built:

``` text
max entries per archive     500
max total expanded bytes    the per-request byte cap
nested archives             not expanded — skipped, with a reason
```

`zip_parent_name` is stored on each file row so the UI can group the
forty rows under the archive they came from, and so a support question
about "the invoices zip" is answerable.

**Server-side expansion is the named fallback**, not a second code path
to build now: if archives turn out to be large enough that browser
expansion is painful, the archive uploads as one object and the inspect
worker expands it into sibling file rows. The `zip_parent_name` column
already accommodates that, so it is a change in one place.

------------------------------------------------------------------------

# 20. Upload Verification

``` text
POST /api/upload          §0.3
```

> **Route and payload are now §0.3**, and it is **batch-shaped**: one
> call may carry several completed files. The per-file work below is
> unchanged and is performed once per entry, idempotently.

Called after each `PUT` returns — batched, or one at a time. The server
re-checks each object itself and never trusts the client's word that
bytes arrived.

The handler must:

1.  resolve the user and confirm the file belongs to them;
2.  confirm the file is at stage `UPLOADING`;
3.  **read the object's metadata from GCS** and confirm it exists;
4.  store `generation`, `checksum` and the true `size_bytes`;
5.  reject with `too_large` if the stored size exceeds the cap, even
    though the declared size passed — the declared size was a claim;
6.  advance the stage to `UPLOADED`;
7.  write an outbox row for the **inspect** topic, in the same
    transaction (§24);
8.  return the file row.

``` json
{ "fileId": "file_7a2", "stage": "UPLOADED" }
```

**Never mark a file uploaded because `/api/getSignedUrl` returned
successfully.** Handing out a signed URL says nothing about whether
anything was written to it.

**This call starts shape-reading only. It does not start processing.**
That distinction is the whole gate (§22).

------------------------------------------------------------------------

# 21. API: the request snapshot

> **Now served by §0.7 `POST /api/polling/result`**, polled on a timer
> rather than fetched once beside an event stream. The computed fields
> below are still computed by the server, for the reason given under the
> example.

The frontend's snapshot — on load, on refresh, and on every poll.

``` json
{
  "requestId": "req_01KABC",
  "status": "COLLECTING",
  "counts": { "total": 40, "uploaded": 38, "schemaReady": 31, "failed": 2 },
  "convertAvailable": false,
  "convertBlockedReason": "7 files are still reading their shape.",
  "pausedUntil": null,
  "latestEventId": 1482,
  "files": [
    {
      "fileId": "file_7a2",
      "filename": "invoice-204.pdf",
      "zipParentName": "invoices.zip",
      "stage": "SCHEMA_READY",
      "schemaIds": ["sch_31"],
      "failureClass": null
    }
  ]
}
```

`convertAvailable` and `convertBlockedReason` are computed by the server.
The frontend renders the reason next to a disabled button rather than
deriving the rule a second time — and the server enforces the same rule
in §22 regardless of what the button did.

`latestEventId` is where the live stream resumes from.

------------------------------------------------------------------------

# 22. API: POST /api/convert

> **Route and payload are now §0.6.** The transaction below is the
> implementation and is unchanged.

The one gate in the product. Everything before it is free; everything
after it costs money.

``` json
{ }
```

The handler must, in one transaction:

1.  resolve the user and confirm the request belongs to them;
2.  confirm the request status is `COLLECTING` or `READY`;
3.  **re-check the gate itself** — every file is `SCHEMA_READY` or
    `FAILED`;
4.  set `requests.status = CONVERTING` and `converted_at = now()`;
5.  move every `SCHEMA_READY` file to stage `CONVERTING`;
6.  write **one outbox row per file** for the **convert** topic;
7.  write a `CONVERT_REQUESTED` event.

``` json
{ "requestId": "req_01KABC", "status": "CONVERTING", "queued": 38, "skipped": 2 }
```

Gate not met:

``` json
{
  "failureClass": "gate_not_met",
  "message": "7 files are still reading their shape.",
  "nextStep": "Wait for them to finish, or remove them.",
  "pending": 7
}
```
→ `409`.

**The server owns the gate.** A greyed-out button is a courtesy to the
user, not the enforcement.

**Schemas freeze here.** After this point `POST /api/updateSchema` returns
`409`: rows are being written against an approved shape, and letting it
move underneath produces a table where half the rows were made under one
set of rules and half under another.

`skipped` counts files that were already `FAILED`. They are carried
through as failures rather than blocking — one unreadable file must not
hold thirty-eight good ones hostage.

------------------------------------------------------------------------

# 23. Pub/Sub Topics and Messages

**Two topics, because there are two workers** (§26) and the work either
side of the Convert gate is not the same work.

``` text
<prefix>-file-uploaded     -> inspect worker    "read this file's shape"
<prefix>-convert-requested -> convert worker    "the user approved; process it"
```

Each has its own push subscription, its own dead-letter topic and its own
service account. Nothing subscribes to both.

Both carry the **same tiny body**, so the two workers have the same
contract:

``` json
{ "fileId": "file_7a2" }
```

and the same tracing attributes:

``` text
attributes:
  requestTraceId = "req_8f1c"
  userId         = "usr_1a2b"
  requestId      = "req_01KABC"
```

The worker retrieves everything authoritative from PostgreSQL. It reads
the file row, sees the stage, and advances it. Which topic a message
arrived on tells it which service it is, not what to do — the row does
that.

**Attributes are for tracing only.** A worker must never make an
authorization decision from the `userId` attribute; it loads the file and
reads the owner from the database. A Pub/Sub attribute is metadata about
a message, not proof of anything.

Do not put file bytes into Pub/Sub. Do not put file contents into
PostgreSQL.

------------------------------------------------------------------------

# 24. Database / Pub/Sub Consistency — the transactional outbox

## 24.1 The problem being solved

Writing to PostgreSQL and publishing to Pub/Sub are two systems and
cannot be committed together. A naive sequence has two failure windows,
and the second is the dangerous half:

``` text
write row  ->  publish  ->  mark queued

           ^             ^
           |             |
   publish never     publish SUCCEEDED and the process died.
   happened:         A worker is already processing a row that
   row is orphaned   does not say it was queued.
```

Marking the row `FAILED` on a publish error is also wrong: a transient
Pub/Sub error is retryable, and failing terminally throws away work the
user asked for with no route back.

**Implement the outbox now.** One table, one relay, one scheduled
trigger. Retrofitting it once the real processor exists is much more
expensive, because by then the row carries paid-for work.

## 24.2 Write path

Both producers — `/api/files/:id/uploaded` and
`/api/requests/:id/convert` — use the same shape:

``` text
+--------------- one transaction ---------------+
|  UPDATE the file row (stage)                  |
|  INSERT file_events                           |
|  INSERT request_outbox  (status = PENDING,    |
|                          topic = …)           |
+------------------- COMMIT --------------------+
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
   mark PUBLISHED          leave PENDING. Log at WARN.
                           Do NOT fail the API response.
```

The inline publish removes scheduler latency in the common case. If it
throws, is slow, or the process is killed mid-call, **nothing is lost** —
the `PENDING` row is committed and the relay picks it up.

At-least-once publishing is the accepted consequence: the inline attempt
may succeed and its acknowledgement be lost, so the relay publishes
again. §31 makes duplicate delivery harmless.

## 24.3 The relay and the sweep

One internal endpoint, driven by Cloud Scheduler every minute. **Both
workers expose it**; either may run it, because everything it does is
claimed with `SKIP LOCKED`.

``` text
Cloud Scheduler (1 min, OIDC)
        |
        v
POST /internal/sweep
        |
        +--> publish PENDING outbox rows
        +--> reclaim files with expired leases       (§31.2)
        +--> resume requests whose paused_until has passed
```

Claiming outbox rows:

``` sql
UPDATE request_outbox
   SET attempts        = attempts + 1,
       next_attempt_at = now() + (interval '10 seconds' * power(2, attempts)),
       updated_at      = now()
 WHERE id IN (
       SELECT id FROM request_outbox
        WHERE status = 'PENDING' AND next_attempt_at <= now()
        ORDER BY created_at
        LIMIT 100
        FOR UPDATE SKIP LOCKED
 )
RETURNING *;
```

`FOR UPDATE SKIP LOCKED` is what makes the relay safe to run
concurrently — two sweeps claim disjoint rows instead of
double-publishing or blocking. Do not replace it with a status flag plus
a separate `SELECT` and `UPDATE`; that has a race in it.

When `attempts >= 10`:

``` text
request_outbox.status = DEAD
files.stage           = FAILED
files.failure_class   = internal
file_events           <- FILE_FAILED
```

This is the **only** path by which a publish failure becomes a failed
file, and it happens after roughly three hours of retries rather than on
the first error.

## 24.4 Alerting

A `PENDING` outbox row older than five minutes means the sweep is not
running. Surface it on the health endpoint (§40) and alert on it. A
silent outbox is indistinguishable from a working one until a user
notices their files never started.

------------------------------------------------------------------------

# 25. API: the remaining endpoints

## 25.1 Reading one file's shapes

> **Now served by §0.4 `POST /api/polling/schema`**, which returns the
> same objects as a delta over the whole request instead of one file at
> a time. The rules below still hold.

Read the shapes the inspect worker wrote. This is what the UI shows on
**Preview / Edit** before Convert.

``` json
{
  "fileId": "file_7a2",
  "stage": "SCHEMA_READY",
  "schemas": [
    {
      "id": "sch_31",
      "tableOrd": 0,
      "tableLabel": "Sheet 1",
      "version": 1,
      "fields": [
        { "key": "invoice_no", "label": "Invoice No", "type": "text", "origin": "detected" },
        { "key": "total", "label": "Total", "type": "currency", "origin": "detected" }
      ],
      "matchingSchemaIds": ["sch_44", "sch_51"],
      "matchingFileCount": 12
    }
  ]
}
```

`matchingSchemaIds` is the set of schemas in this request whose
**`original_fields` hash equals this one's** — resolved server-side from
`shape_hash`, so the Apply-to-all control can show its count without a
second call.

A file with no shape returns `200` with an empty `schemas` array and a
failure class of `schema_not_found`, not a `404`. The file exists; its
shape does not.

## 25.2 Reading every shape in the request

> **Now served by §0.4**, which is request-scoped by construction.

Every ready schema in the request at once, for the all-files review view.
Same object shape, grouped by `shape_hash` so identical shapes sit
together with a count.

Available as soon as **any one** schema is ready — the user can start
looking while the rest are still arriving.

## 25.3 Saving an edited shape

> **Route and payload are now §0.5 `POST /api/updateSchema`**, where
> `applyToSchemaIds` is expressed as additional entries in the `files`
> array rather than as a separate list. Every rule below survives that
> change verbatim.

**Implement it.** An earlier draft left this as a `501` stub because the
schema editor was out of scope; it is now the centre of the Prepare
screen, so a stub makes that screen untestable end to end.

Request:

``` json
{
  "fields": [
    { "key": "invoice_no", "label": "Invoice No", "type": "text" }
  ],
  "applyToSchemaIds": ["sch_44", "sch_51"]
}
```

Intended response:

``` json
{ "updated": [{ "id": "sch_31", "version": 2 }], "appliedTo": 12 }
```

These rules are the endpoint:

-   **Exactly two edits exist**: change a field's `type`, and add a
    field. A request that renames or removes a field is rejected with
    `409`, compared against `original_fields` — the server enforces it
    rather than trusting the UI not to send one.
-   **`applyToSchemaIds` travels with the save.** The server never
    reconstructs which files the user meant; it validates that each id
    genuinely shares this schema's original `shape_hash` and rejects the
    whole call if one does not.
-   Every affected row bumps `version` and sets `edited_at`.
-   After Convert, this returns `409` — schemas are frozen (§22).

## 25.4 The live stream — removed

**There is no SSE endpoint.** The browser learns about progress from the
two polling endpoints, §0.4 before the gate and §0.7 after it.

What that buys, and what it costs:

-   The serverless duration cap stops mattering. A stream that is cut
    every few minutes needed replayable event ids, a `Last-Event-ID`
    handler and a reconnect path; a poll needs none of those, and the
    "live updates interrupted" state collapses into "the last poll
    failed, we are trying again".
-   Latency becomes the poll interval. At 2 s that is invisible against
    stages that take seconds to minutes.
-   Cost becomes one cheap query per client every 2 s. Both polling
    handlers must therefore be **single-query, index-backed reads** —
    `(request_id)` on `files`, `(request_id, status)` for the counts.
    A handler that fans out per file will not survive forty tabs.

**`file_events` stays.** It is the audit trail, it is what §40.3 reads
to answer "is work actually moving", and it is what a support question
is answered from. Nothing subscribes to it from a browser.


## 25.5 POST /api/merges

Merge finished tables into one. Explicit, never automatic, and available
only once the request has finished.

``` json
{
  "userId": "usr_1a2b",
  "requestId": "req_01KABC",
  "tableNames": ["invoices-jan", "invoices-feb", "invoices-mar"]
}
```

The handler must:

1.  resolve the user; confirm the request belongs to them, and reject
    with `403` if `userId` disagrees with the cookie;
2.  confirm the request status is `COMPLETED`;
3.  resolve each name in `tableNames` to a schema in **this request** —
    an unknown name is `404`, and a name belonging to another user's
    request is `403`, never `404`, and never silently dropped;
4.  compare the schemas: **same field names, same field types,
    order-independent**;
5.  if they agree, create the merge and return it;
6.  if they do not, return `409` **before merging anything** — never a
    partial merge.

Success:

``` json
{ "mergeId": "mrg_04", "rowCount": 182, "tableCount": 3,
  "fieldSignature": [ { "key": "invoice_no", "type": "text" } ] }
```

Conflict:

``` json
{
  "failureClass": "merge_incompatible",
  "message": "`Invoice No` is text in 2 tables and number in 1.",
  "conflicts": [
    {
      "field": "invoice_no",
      "groups": [
        { "type": "text",   "tableNames": ["invoices-jan", "invoices-feb"] },
        { "type": "number", "tableNames": ["invoices-mar"] }
      ]
    }
  ]
}
```

Conflicts are grouped by type and carry the table names, so the UI can
put the error **on the card that caused it** rather than in a summary at
the bottom. The user needs to see *which* selection is the problem, not
only that there is one.

**The check is exact. No widening, no subsetting, no coercion.** Widening
is the dangerous option precisely because it always succeeds: it quietly
turns a number column into text, and every total calculated downstream is
then wrong in a way nobody can see. Being told *"`Invoice No` is text in
2 tables and number in 1"* is a worse moment and a better outcome.

A merge stores a **selection, not a copy** — `merges` plus
`merge_members` — so a merged table inherits every cell's state for free
and costs nothing to undo.

## 25.6 Reading rows — later

`GET /api/files/:fileId/rows` and `GET /api/merges/:mergeId/rows` are the
endpoints the tables read from. **They are not built in this phase**,
because nothing yet writes rows — the worker produces a dummy artifact
(§29).

The intended shape is recorded here so the tables and the merge endpoint
are not designed around a placeholder:

``` json
{
  "rows": [
    {
      "recordId": "rec_9",
      "needsReview": true,
      "values": {
        "total": {
          "valueId": "val_9",
          "value": 4200,
          "display": "4,200.00",
          "state": "marked",
          "reason": "Line items sum to 4,180 but the total says 4,200."
        }
      }
    }
  ],
  "nextCursor": null
}
```

`state` is one of `value · not-found · marked · failed-row`, and **the
server decides it**. If the UI derives "is this cell worth checking" a
second time, the two answers drift.

`not-found` is never rendered as blank and never as zero. A blank says we
do not know; a zero says the value *was* zero. Those are different
claims, and one of them is false.

# 26. Two Cloud Run Workers

The Convert gate splits the pipeline in half, so it splits the worker in
half too. **Two Cloud Run services, two topics, two subscriptions, two
service accounts.**

``` text
  file lands in GCS                          user presses Convert
        |                                            |
        v                                            v
 <prefix>-file-uploaded                   <prefix>-convert-requested
        |                                            |
        v                                            v
+------------------+                      +------------------+
| inspect-worker   |                      | convert-worker   |
|                  |                      |                  |
| reads the file,  |                      | does the real    |
| writes its       |                      | extraction       |
| schema to        |                      |                  |
| Postgres         |                      | (later)          |
+------------------+                      +------------------+
        |                                            |
        v                                            v
  file_schemas                              rows in Postgres
  stage = SCHEMA_READY                      stage = COMPLETED
```

## 26.1 Why two services and not one with a branch

-   **They have different shapes of work.** Inspection is short and runs
    on upload for every file, whether or not the user ever converts.
    Conversion is long, expensive, and runs only on approval. One
    service means one scaling policy, one memory limit and one timeout
    for two very different jobs.
-   **They fail independently.** A crash loop in extraction must not
    stop new uploads from being inspected — otherwise the user cannot
    even see the shapes to decide with.
-   **The expensive one can be locked down harder.** Only the convert
    worker ever needs a model key. The inspect worker never gets one.
-   **The boundary is already where the product's gate is**, so it does
    not need to be invented later.

They share a container image and a codebase — same claim logic, same
lease, same sweep. `SERVICE_ROLE=inspect|convert` selects the processor
at startup. One image, two deployments, two sets of environment
variables.

## 26.2 What each one does in this phase

**Both are deliberately trivial.** No AI, no OCR, no parsing.

| | inspect-worker | convert-worker |
|---|---|---|
| Triggered by | a file finishing upload | the user pressing Convert |
| This phase does | reads the object, writes a placeholder schema row, sets `SCHEMA_READY` | reads the object, writes `result.txt`, sets `COMPLETED` |
| Later becomes | real schema inference | the real extraction engine |
| Needs a model key | no, ever | yes, later |

The placeholder schema the inspect worker writes is a fixed shape, so the
UI has something real to fetch and render through the whole
Preview / Edit flow before any inference exists:

``` json
{
  "tableOrd": 0,
  "tableLabel": "Table 1",
  "fields": [
    { "key": "column_a", "label": "Column A", "type": "text",   "origin": "detected" },
    { "key": "column_b", "label": "Column B", "type": "number", "origin": "detected" }
  ]
}
```

`original_fields` gets the same value and `shape_hash` is computed from
it — so apply-to-all matching, grouping by shape, and the merge
compatibility check are all exercised end to end from day one, even
though every file happens to produce the same shape.

## 26.3 Repository layout

``` text
packages/
├── web/
│
└── worker/
    ├── src/
    │   ├── main.py              FastAPI app; routes by SERVICE_ROLE
    │   ├── config.py
    │   ├── pubsub_handler.py    envelope parsing, shared by both
    │   ├── models.py
    │   ├── database.py
    │   ├── gcs.py
    │   ├── leases.py            claim, renew, release          (§31.1)
    │   ├── outbox.py            relay                          (§24.3)
    │   ├── sweep.py             POST /internal/sweep           (§24.3, §31.2)
    │   ├── health.py            /health /readyz /healthz       (§40)
    │   ├── failures.py          the failure class list         (§12.4)
    │   └── processors/
    │       ├── inspect.py       <- replaced by schema inference
    │       └── convert.py       <- replaced by the extraction engine
    │
    ├── tests/
    ├── requirements.txt
    ├── Dockerfile
    └── README.md
```

Only the two files in `processors/` are replaced in the next phase.
Everything else — leasing, outbox, sweep, health, failure classes — is
infrastructure and must survive that replacement untouched.

------------------------------------------------------------------------

# 27. Worker Technology

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

Use only what is actually needed. No document libraries, no model
clients, no OCR in this phase.

Each service exposes:

``` text
POST /                    Pub/Sub push envelope          (§28)
POST /internal/sweep      Cloud Scheduler                (§24.3, §31.2)
GET  /health              liveness                       (§40.1)
GET  /readyz              readiness                      (§40.2)
GET  /healthz             queue and outbox state         (§40.3)
```

`POST /` and `POST /internal/sweep` are IAM-protected by Cloud Run and
invoked with OIDC tokens by their own service accounts. The three `GET`
endpoints are reachable by Cloud Run's probes and by anything holding
`roles/run.invoker`; they return counts only.

------------------------------------------------------------------------

# 28. Worker Contract

Identical in both services. Only the processor differs.

1.  accept `POST`;
2.  bind `requestTraceId` and `userId` from the message attributes to the
    log context, **before parsing anything** (§12.5);
3.  validate the envelope;
4.  decode `message.data` and parse `{ fileId }`;
5.  **claim the file with a conditional UPDATE** (§31.1) — this loads it
    and advances its stage atomically;
6.  branch on the claim result (§31.1) — a file that was not claimable is
    not an error;
7.  run the processor for this `SERVICE_ROLE`;
8.  on success, advance the stage and clear the lease in one statement;
9.  on a classified failure, set `failure_class` and decide retryable vs
    terminal from §12.4;
10. return the HTTP status the branch in §31.1 selected.

Steps 5 and 8 are the only places stage changes. Do not write a stage
anywhere else.

------------------------------------------------------------------------

# 29. Worker Processing Logic

## 29.1 inspect-worker

``` text
claim file at UPLOADED -> INSPECTING
      |
      v
read the object from GCS
      |
      v
sniff magic bytes -> detected_content_type
      |
      +-- disagrees with the declared type -> FAILED / format_corrupt
      |
      v
write ONE file_schemas row (the placeholder shape, §26.2)
  - fields, original_fields, shape_hash
      |
      v
write SCHEMA_WRITTEN event
      |
      v
stage = SCHEMA_READY
      |
      v
if every file in the request is now settled -> request.status = READY
```

That last step is what makes the Convert button light up, and it is
computed in the worker rather than polled by the UI.

## 29.2 convert-worker

``` text
claim file at CONVERTING
      |
      v
read the object from GCS
      |
      v
build the text:  "Successfully processed <original_filename>"
      |
      v
write requests/<requestId>/output/<fileId>/result.txt
      |
      v
write OUTPUT_WRITTEN event
      |
      v
stage = COMPLETED
      |
      v
if every file in the request is terminal -> request.status = COMPLETED
```

No AI and no document processing is involved in either. That is the
point of this phase.

------------------------------------------------------------------------

# 30. Output Path

``` text
requests/<requestId>/output/<fileId>/result.txt
```

Contents, exactly:

``` text
Successfully processed invoice-204.pdf
```

where `invoice-204.pdf` is `files.original_filename` — **the name the
user gave the file**, not the object key and not the safe-filename
segment. The object key carries an id prefix and a sanitised name, and
neither is what a person would recognise.

------------------------------------------------------------------------

# 31. Idempotency, Leasing and Stuck-File Recovery

Pub/Sub delivers at least once, and the outbox publishes at least once on
top of that. Duplicate delivery is the normal case, not the edge case.

A status check alone does not cover the case that actually hurts: a
worker that died **after** marking a file in-progress. That file is
in-progress forever, and a status check tells the next delivery nothing
about whether anyone is still working on it.

The fix is a lease, and it is one conditional `UPDATE`.

## 31.1 Claiming — the only way a file advances

``` sql
UPDATE files
   SET stage         = :next_stage,     -- INSPECTING or CONVERTING
       claimed_by    = :instance_id,
       claimed_until = now() + :lease_duration,
       attempts      = attempts + 1,
       updated_at    = now()
 WHERE id = :file_id
   AND (
         stage = :from_stage            -- UPLOADED or CONVERTING-pending
      OR (stage = :next_stage AND claimed_until < now())
       )
   AND attempts < max_attempts
RETURNING *;
```

One statement, so two concurrent deliveries cannot both win: PostgreSQL
serialises the row update and exactly one gets a row back.

If it returns **no row**, read the file and branch:

| File state | Meaning | HTTP | Why |
|---|---|---|---|
| already past this stage | An earlier delivery finished it | **200** | Ack. Duplicate, nothing to do |
| `FAILED` | Terminal | **200** | Ack. Redelivery cannot change the outcome |
| in progress, lease live | Another instance is working on it | **409** | Nack. Pub/Sub backs off; the next delivery finds it done, or finds an expired lease and takes over |
| `attempts >= max_attempts` | Exhausted | **200** | Ack, and set `FAILED` / `max_attempts` if not already |
| not found | Unknown id | **200** | Ack. Redelivery cannot make the row appear; log at ERROR |

**Returning 200 for an unprocessable message is deliberate.** Nacking a
message that can never succeed just burns redeliveries until the
dead-letter policy fires. Nack only when retrying later could plausibly
work — which, in this table, is exactly the live-lease row.

## 31.2 Lease duration, renewal and the reaper

``` text
lease duration            600 s
Pub/Sub ack deadline      600 s   (the maximum)
Cloud Run request timeout 900 s   (> ack deadline)
```

The lease must be longer than the work, and the ack deadline at least as
long as the lease, or a file whose worker is perfectly healthy gets
stolen.

**Renewal.** A fixed 600 s lease is enough for both trivial processors,
but the real extraction engine will exceed it — so implement renewal now.
A background task issues

``` sql
UPDATE files SET claimed_until = now() + :lease_duration
 WHERE id = :file_id AND claimed_by = :instance_id;
```

every `lease_duration / 3`, stopping when processing ends. The
`claimed_by` predicate means a worker that has already lost its lease
cannot take it back.

**The reaper.** A lease expiring is only useful if something notices. A
file can reach a state where no message will ever be redelivered — it was
acked before the crash, or the dead-letter policy already fired. The
scheduled sweep (§24.3) therefore also runs:

``` sql
-- 1. reclaim: send expired-lease files back to their pre-claim stage
UPDATE files
   SET stage         = CASE stage WHEN 'INSPECTING' THEN 'UPLOADED'
                                  ELSE 'CONVERTING' END,
       claimed_by    = NULL,
       claimed_until = NULL
 WHERE claimed_until < now()
   AND stage IN ('INSPECTING', 'CONVERTING')
   AND attempts < max_attempts
RETURNING id, request_id, stage;
-- then INSERT a fresh request_outbox row per reclaimed file, on the
-- topic that matches its stage, and write a FILE_RECLAIMED event.

-- 2. give up
UPDATE files
   SET stage         = 'FAILED',
       failure_class = 'max_attempts',
       claimed_by    = NULL,
       claimed_until = NULL
 WHERE claimed_until < now()
   AND stage IN ('INSPECTING', 'CONVERTING')
   AND attempts >= max_attempts;
```

The reclaim path goes back through the **outbox**, not straight to
Pub/Sub, so there remains exactly one way a file gets queued.

## 31.3 Dead-letter topics

Each subscription gets its own dead-letter policy:

``` text
max_delivery_attempts   5
dead_letter_topic       <prefix>-file-uploaded-dlq
                        <prefix>-convert-requested-dlq
```

Grant the Pub/Sub service agent `roles/pubsub.publisher` on each DLQ topic
and `roles/pubsub.subscriber` on each source subscription, or the policy
silently does nothing.

Create a **pull** subscription on each DLQ for inspection. Nothing
consumes them automatically in this phase — their job is to stop a poison
message cycling forever and leave the evidence where a human can read it.
Alert on DLQ depth > 0.

## 31.4 Output writes

Output paths are deterministic, so a repeated run overwrites the same
object and the content is a pure function of the file row. Do not create a
second output location, and do not create a second file row.

------------------------------------------------------------------------

# 32. Cloud Run Service Accounts

**One per service**, not one shared between them.

``` text
structured-data-<env>-inspect-worker
structured-data-<env>-convert-worker
```

| Permission | inspect | convert |
|---|---|---|
| Read objects under `requests/*/input/` | yes | yes |
| Write objects under `requests/*/output/` | **no** | yes |
| Connect to Cloud SQL (`roles/cloudsql.client`) | yes | yes |
| Read the DB password secret | yes | yes |
| Read `SESSION_SECRET` | no | no |
| Read model credentials | **never** | later |
| Publish to either topic (for reclaims, §31.2) | yes | yes |

Do not grant project Owner or Editor to either.

Two accounts rather than one is worth the extra Terraform: the inspect
worker never writes output and never holds a model key, and the only way
to keep that true over time is for it to be structurally unable to do
either. A shared account makes both properties a matter of what the code
happens to do today.

------------------------------------------------------------------------

# 33. Pub/Sub Push Authentication

Create a dedicated service account for Pub/Sub invocation, and grant it
`roles/run.invoker` on **each** Cloud Run service:

``` text
structured-data-<env>-pubsub-invoker
   ├── roles/run.invoker on <prefix>-inspect-worker
   └── roles/run.invoker on <prefix>-convert-worker
```

Both push subscriptions are configured with authenticated OIDC tokens
using that account. Scope each subscription's push endpoint to its own
service — the `file-uploaded` subscription pushes to the inspect worker
and nothing else.

The Cloud Scheduler job uses its own account,
`structured-data-<env>-scheduler-invoker`, also with `roles/run.invoker`
on both services, so the sweep can run against either.

**Neither Cloud Run service allows unauthenticated invocation.**

------------------------------------------------------------------------

# 34. Cloud Run Configuration

**Two services from one image**, deployed separately (§26).

``` text
                        inspect-worker          convert-worker
service name            <prefix>-inspect-worker <prefix>-convert-worker
region                  asia-south1             asia-south1
SERVICE_ROLE            inspect                 convert
min instances           0                       0
max instances           5                       3
CPU                     1                       1
memory                  512Mi                   1Gi
concurrency             1                       1
request timeout         900s                    900s
```

Both timeouts must exceed the 600s Pub/Sub ack deadline.

**Why `max instances` is not `1`.** With `concurrency: 1`, max instances
*is* the parallelism of the whole system. At `1`, every message beyond
the first waits, and any message waiting past the ack deadline is
redelivered — so a queue that is merely busy looks exactly like a queue
that is failing. It also starves `/internal/sweep`, which is the thing
that recovers from the failure you have just manufactured.

The inspect worker gets more headroom than the convert worker because it
runs on **every** file at upload, including files the user never
converts, and its work is short. The convert worker is bounded lower
because its work is long and, later, expensive.

Both stay at `concurrency: 1`: the processor is CPU-bound and holds a
database connection per request.

Environment differences between the two are only:

``` text
SERVICE_ROLE              inspect | convert
PUBSUB_TOPIC (for sweep)  which topic reclaimed files go back to
model credentials         convert-worker only, and not in this phase
```

The inspect worker must **never** be granted a model key. It does not
need one now and will not need one later — keeping that true is free
today and awkward to reclaim once both services share a secret.

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
`/api/getSignedUrl` returns 500 with
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
`vercel env pull` and `vercel dev`, or accept that `/api/getSignedUrl`
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

PUBSUB_TOPIC_FILE_UPLOADED=
PUBSUB_TOPIC_CONVERT_REQUESTED=

# Session signing (§12.2). Rotating this logs everyone out, which is correct.
SESSION_SECRET=

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

# Local development only — hardcodes the current user (§12.1).
# NEVER set either of these in Vercel, for production or preview.
# The server must refuse to start if ALLOW_DEV_USER is true in production.
ALLOW_DEV_USER=false
DEV_USER_ID=
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
POST /api/getSignedUrl
```

Verify:

-   validation works;
-   file record is created;
-   signed URL is returned;
-   no credentials are returned.

Upload a small test file using the returned URL.

Verify the object exists in GCS.

------------------------------------------------------------------------

## Test Module 6 --- Next.js Request APIs

Call:

``` http
POST /api/getSignedUrl
POST /api/upload
POST /api/convert
```

Verify:

-   `userId` is checked against the session cookie;
-   file ownership is checked;
-   GCS object existence is checked before a file is marked `UPLOADED`;
-   `UPLOAD_CONFIRMED` and `CONVERT_REQUESTED` events exist;
-   a `request_outbox` row exists for each, on the right topic;
-   Pub/Sub messages publish and the outbox rows become `PUBLISHED`;
-   the same `requestId` posted twice returns the same rows, not
    duplicates.

Then verify the outbox actually works, which is the only part that
matters:

-   **Publish failure.** Point the publisher at a non-existent topic, or
    revoke `roles/pubsub.publisher` on the Vercel service account. Call
    `POST /api/upload`. The API must still return `200`,
    the file must be `UPLOADED`, and the outbox row must remain
    `PENDING` with `attempts >= 1`. **The file must not be `FAILED`.**
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
GET /api/requests/<requestId>
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

Two fixtures:

``` text
hello.txt              contents: "Hello backend."
invoices.zip           containing hello.txt and goodbye.txt
```

## 42.1 The single-file path

``` text
 1. Open the deployed application
 2. Browser generates a userId; POST /api/register
 3. Select hello.txt
 4. POST /api/getSignedUrl   -> request row + file row + one signed URL
 5. Browser PUTs hello.txt straight to GCS
 6. POST /api/upload
      -> object verified, stage = UPLOADED
      -> outbox row committed IN THE SAME TRANSACTION
 7. Message published to <prefix>-file-uploaded
 8. Pub/Sub pushes to the INSPECT worker
 9. Inspect worker claims the file, writes a file_schemas row,
      stage = SCHEMA_READY, request status = READY
10. POST /api/polling/schema  -> the UI shows the shape
        ┌─────────────────────────────────────────────┐
11.     │  NOTHING HAS BEEN PROCESSED YET.            │
        │  Verify no object exists under output/.     │
        └─────────────────────────────────────────────┘
12. User presses Convert
13. POST /api/convert
      -> stage = CONVERTING, outbox row per file
14. Message published to <prefix>-convert-requested
15. Pub/Sub pushes to the CONVERT worker
16. Convert worker reads hello.txt from GCS, writes result.txt,
      stage = COMPLETED, request status = COMPLETED
17. Frontend shows COMPLETED, driven by POST /api/polling/result
```

Final GCS output:

``` text
requests/<requestId>/output/<fileId>/result.txt
```

Content, exactly:

``` text
Successfully processed hello.txt
```

**Step 11 is the acceptance criterion that matters most.** Anyone can
build a pipeline that processes on upload. The thing being proven here is
that it *doesn't* — that a schema is produced, shown, and waited on.

## 42.2 The archive path

``` text
1. Select invoices.zip
2. The browser expands it — the archive is NEVER uploaded
3. POST /api/getSignedUrl carries TWO files, not one
4. Two file rows, two signed URLs, two independent progress bars,
     both carrying zipParentName = "invoices.zip"
5. Both inspect, both reach SCHEMA_READY
6. Convert produces two result.txt objects under the same request prefix
```

## 42.3 The recovery path

``` text
1. Upload a file and let it reach CONVERTING
2. Kill the convert worker mid-processing
3. Confirm the file is stuck at CONVERTING with a live lease
4. Expire the lease (or wait it out)
5. Trigger POST /internal/sweep
6. Confirm: file returns to its pre-claim stage, a fresh outbox row
     appears, a FILE_RECLAIMED event is written, and the file goes on
     to COMPLETE without anyone touching the UI
```

All three paths must pass. The first proves the gate, the second proves
archives, the third proves the system heals itself — and the third is the
one that is never tested until it is needed in production.

------------------------------------------------------------------------

# 43. Debugging Protocol

When a test fails, debug only one boundary at a time.

Use this sequence:

``` text
1. Next.js application
       |
2. /api/getSignedUrl
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

## 43.1 Boundary 4 — `browser -> GCS`

This boundary produces one symptom for three unrelated causes, and the
symptom names the wrong one. The browser console will say some variant
of *"blocked by CORS policy"* whether or not CORS is the problem, because
a GCS error response carries no CORS headers and the browser reports the
missing headers rather than the status underneath.

**Do not change the CORS configuration until this decision tree says
to.**

``` text
Does the same signed URL work from curl?
 |
 ├── NO  -> not a browser problem at all.
 |          The URL, the signature or IAM is wrong.
 |          Go back to boundary 3. (§37.1, §37.2)
 |
 └── YES -> the URL is fine. Open the Network tab and find the
            OPTIONS request that precedes the PUT.
             |
             ├── OPTIONS is missing entirely
             |     -> the request was same-origin or never issued.
             |        Check you are PUTting to the GCS host and not
             |        proxying through /api (§10).
             |
             ├── OPTIONS returns 403 / no Access-Control-Allow-Origin
             |     -> genuine CORS. The bucket has no CORS config, or
             |        the origin is not in it. Fix §9.1.
             |        Remember: exact strings or "*", no partial
             |        wildcards, so preview hostnames need "*".
             |
             └── OPTIONS returns 200, PUT fails
                   -> NOT CORS. Read the PUT's status:
                        403 SignatureDoesNotMatch
                          -> header mismatch. Compare the request's
                             Content-Type byte-for-byte against what
                             /api/getSignedUrl signed. (§19.1)
                        403 other
                          -> the signing identity lacks object write
                             permission on the bucket.
                        400
                          -> malformed URL or expired signature.
```

Useful one-liner for the second branch — it asks GCS the same question
the browser's preflight asks:

``` bash
curl -i -X OPTIONS "https://storage.googleapis.com/<bucket>/<object>" \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: content-type"
```

A correct configuration echoes `Access-Control-Allow-Origin` and
`Access-Control-Allow-Methods` back. An empty response body with no
`Access-Control-*` headers means the bucket has no matching CORS rule —
and that is the only situation in which editing §9.1 is the right move.

------------------------------------------------------------------------

# 44. Required Logging

Every backend operation must include enough context to identify **both
the job and the person it belongs to**.

API logs:

``` text
requestId
userId
jobId
fileId
event type
stage
error code
```

Worker logs:

``` text
requestId        from the Pub/Sub attribute  (§23)
userId           from the Pub/Sub attribute
job_id
file_id
gcs_object
event
```

`requestId` and `userId` must be bound to the log context **once**, at
the entry point — the route handler for the API, the push handler for
the worker — so that every later line carries them without anyone having
to remember. A field that has to be passed by hand into each log call is
a field that will be missing from the one line you need.

The payoff is that both of these are single filters rather than
investigations:

``` text
requestId = "req_8f1c…"      everything one click caused, across both services
userId    = "usr_dev_0001"   everything this person has ever done
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

There are **two lists**, and keeping them apart is the point.

## 45.1 Failure classes — what the user sees

The closed set in **§12.4**. Every API error response uses that
envelope, and nothing else ever reaches a screen:

``` json
{
  "failureClass": "too_large",
  "message": "This file is 82 MB. The limit is 50 MB.",
  "nextStep": "Split the file, or remove it and carry on.",
  "requestTraceId": "req_8f1c"
}
```

## 45.2 Internal codes — what the logs see

These appear in logs, in `files.failure_detail` and in
`requests.error_code`. Each maps to a failure class **before** anything
is returned:

``` text
UNAUTHENTICATED
FILE_ACCESS_DENIED
REQUEST_NOT_FOUND
FILE_NOT_FOUND
SCHEMA_NOT_FOUND
GCS_OBJECT_NOT_FOUND
UPLOAD_NOT_COMPLETE
PUBSUB_PUBLISH_FAILED
WORKER_PROCESSING_FAILED
WORKER_MAX_ATTEMPTS
FILE_LEASE_HELD
DATABASE_ERROR
OUTPUT_WRITE_FAILED
NOT_IMPLEMENTED
```

Three behave unusually and are worth stating:

-   `PUBSUB_PUBLISH_FAILED` is terminal **only** after the outbox has
    exhausted its retries (§24.3) — never on a first publish error.
-   `FILE_LEASE_HELD` accompanies the `409` in §31.1. It is a signal to
    Pub/Sub, not a user-facing error, and never reaches a screen.
-   `NOT_IMPLEMENTED` is returned by any surface in §0.9 that the
    frontend calls before it exists, and maps to a plain "that isn't
    available yet".

**Never expose a raw stack trace, and never let a screen render a raw
message.** One module maps class to sentence. If a component prints
`error.message` directly, that is a bug regardless of how good the
message happens to read.

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

The frontend is **not** a thin harness on this plan any more. It has its
own design (the v2 canvas), its own screen and component inventories, and
its own task-by-task plan in
[`development-plan.md`](development-plan.md). Build against that; this
section says only where the two meet.

``` text
register  ->  getSignedUrl  ->  PUT to GCS  ->  upload
              ->  polling/schema  ->  updateSchema  ->  convert
              ->  polling/result
```

The contract between them is **§0 and nothing else**. Concretely:

-   The frontend codes against a single typed interface
    (`QuarryApi`, `development-plan.md` §2). The seven routes are one
    implementation of it; the surfaces in §0.9 are a fixture
    implementation of the same interface until they exist.
-   **Every field in §0.8 is a backend deliverable**, not a frontend
    nicety. A3 in particular — `status` and `failure` on
    `/api/polling/schema` — gates the Convert button, and without it the
    upload screen cannot finish.
-   Contract drift is caught by a shared fixture set: the same JSON
    files back the frontend's MSW handlers and the backend's route
    tests. If they disagree, one of the two suites fails.

Do not redesign the UI here, and do not build UI in this plan. Do not
implement document intelligence in this phase (Rule 9).

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
requests
files          (including stage / attempts / claimed_by / claimed_until)
file_schemas
file_events
request_outbox
```

exist, along with the indexes on `files (stage, claimed_until)` and
`request_outbox (status, next_attempt_at)`.

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
POST /api/getSignedUrl
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

## Milestone 4b --- Auth

Implement `register`, `login`, `logout` and `me` (§12.1), the signed
session cookie (§12.2), and the single `resolveUser()` every route
handler calls (§12.3).

Verify:

-   a password is stored only as an argon2id/bcrypt hash;
-   a wrong username and a wrong password give the **same** message;
-   `ALLOW_DEV_USER` works locally and the server refuses to start with
    it set in production;
-   a request whose `userId` disagrees with the cookie gets `403`.

This comes before the upload API, because every route below it needs a
user to attribute work to.

------------------------------------------------------------------------

## Milestone 5 --- Python Worker Skeleton (both roles)

Implement:

``` text
FastAPI, routed by SERVICE_ROLE                (§26.3)
Pub/Sub envelope parsing (shared)
PostgreSQL access (via /cloudsql socket)
GCS access
conditional-UPDATE file claim + lease renewal  (§31.1, §31.2)
POST /internal/sweep — relay + reaper + resume (§24.3, §31.2)
GET /health · GET /readyz · GET /healthz       (§40)
failures.py — the closed class list            (§12.4)
processors/inspect.py  — writes a placeholder schema
processors/convert.py  — writes result.txt
Dockerfile
tests
```

**One image, two roles.** Confirm the same container runs as either by
changing `SERVICE_ROLE` alone.

The inspect processor must write a real `file_schemas` row with
`fields`, `original_fields` and a computed `shape_hash` — so schema
fetch, shape grouping and the merge compatibility check are exercised
end to end before any real inference exists.

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

## Milestone 7 --- Cloud Run Deployment (two services)

Build one image, push to Artifact Registry, deploy it **twice**:

``` text
Docker image
     |
     +--> <prefix>-inspect-worker   SERVICE_ROLE=inspect
     |
     +--> <prefix>-convert-worker   SERVICE_ROLE=convert
```

Verify for each: health endpoint responds, the service is not anonymously
invokable, and it has its own service account with only its own
permissions (§32). Confirm the inspect worker **cannot** write to
`requests/*/output/`.

------------------------------------------------------------------------

## Milestone 8 --- Pub/Sub Integration

Configure **both** topics and both subscriptions:

``` text
<prefix>-file-uploaded      -> push to inspect-worker
<prefix>-convert-requested  -> push to convert-worker

each with: OIDC, run.invoker, ack deadline 600s,
           dead-letter topic + policy (max 5 attempts)
```

Publish a test message to each topic. Verify the correct service
receives it, and that **neither subscription can reach the other
service**.

Verify a message for a non-existent file is **acked** (200) rather than
cycling to the DLQ, per §31.1.

------------------------------------------------------------------------

## Milestone 8b --- Scheduler and Sweep

Configure the Cloud Scheduler job against `POST /internal/sweep` with an
OIDC token and the scheduler invoker service account.

Run **Test Module 8b**.

This milestone must not be deferred to "after E2E works". The outbox
and the reaper are only real once something calls them on a timer.

------------------------------------------------------------------------

## Milestone 9 --- Request, Convert, Schema and Merge APIs

Implement:

``` http
POST /api/upload             transactional: stage + event + outbox   §0.3
POST /api/polling/schema     delta poll; status + failure per entry  §0.4
POST /api/updateSchema       the two edits, scope in the payload     §0.5
POST /api/convert            THE GATE — one outbox row per file      §0.6
POST /api/polling/result     snapshot; stage + counts per table      §0.7
POST /api/merges             exact-match merge, or 409 (§25.5)       — not exposed yet
```

Every field marked **required** in §0.8 ships in this milestone. A3
(`status` + `failure` on `/api/polling/schema`) is the acceptance
condition for the milestone, not a follow-up: without it the frontend's
Convert button can never enable.

Run **Test Module 6**, including the publish-failure and recovery cases.

Two things to verify explicitly, because they are the gate and they are
easy to get subtly wrong:

-   Convert on a request with a file still at `INSPECTING` returns `409`
    with a count — **even if the caller bypasses the UI**.
-   Convert with one `FAILED` file and thirty-eight ready ones succeeds,
    queues thirty-eight, and reports one skipped.

------------------------------------------------------------------------

## Milestone 10 --- Frontend Integration

The UI is built from [`development-plan.md`](development-plan.md), not
from here. This milestone is the **contract handshake** between the two
plans, and it is done when the frontend's live path runs green against
this backend:

``` text
POST /api/register        a browser-generated id
drop files                a .zip is rejected client-side, with a reason
POST /api/getSignedUrl    one signed PUT URL per file
PUT  each file            directly to GCS, two at a time
POST /api/upload          per-file verification, batched
POST /api/polling/schema  shapes arrive one at a time; failures settle too
POST /api/updateSchema    a type change, and an apply-to-all across files
POST /api/convert         the gate
POST /api/polling/result  tables become openable as they finish
```

Two acceptance conditions that are easy to skip and expensive to add
back:

-   **The fixture set is shared.** The JSON that backs the frontend's
    MSW handlers is the same JSON the route tests assert against, so a
    field renamed on one side fails the other side's suite.
-   **`/api/updateSchema` is implemented here, not stubbed.** §25.3's
    `501` was written when the schema editor was out of scope; it is now
    the centre of the Prepare screen, and a stub makes that screen
    untestable end to end.

------------------------------------------------------------------------

## Milestone 11 --- Full E2E

Run the acceptance test in §42 — including the zip path and the gate.

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

## Auth

-   [ ] Register, login, logout and `me` work.
-   [ ] Passwords are stored only as argon2id/bcrypt hashes.
-   [ ] A wrong username and a wrong password return the same message.
-   [ ] The user id is stamped on every request, file, event and log line.
-   [ ] `ALLOW_DEV_USER` works locally and is refused in production.

## Next.js

-   [ ] `/api/getSignedUrl` works **on a deployed Vercel
    environment** (signed URL generation over WIF + `signBlob`).
-   [ ] `/api/getSignedUrl` accepts the Request POJO and returns one URL
    per file, with rejected files carrying a failure class.
-   [ ] `/api/upload` verifies the object before
    advancing.
-   [ ] `/api/polling/schema` returns only files not in `received`, and
    carries `status`, `failure`, `pending`, `convertAvailable` and
    `convertBlockedReason` (§0.8 A3, A4).
-   [ ] A file with several tables comes back as several entries sharing
    one `fileId`, written by the worker in **one** transaction.
-   [ ] `/api/updateSchema` applies one edit across every entry sent,
    rejects the whole call if any `original_fields` hash disagrees, and
    `409`s after Convert.
-   [ ] `/api/polling/result` carries `stage` per table and `counts`
    that sum to the table total, failures included (§0.8 A7).
-   [ ] `/api/merges` merges on an exact match and `409`s otherwise.
-   [ ] Both polling handlers are single, index-backed queries.
-   [ ] Authentication/ownership checks exist.
-   [ ] The current user is resolved **server-side only** — no route
    reads a user id from a request body or an unguarded header.
-   [ ] `ALLOW_DEV_USER` is unset in every deployed environment, and the
    server refuses to start if it is true in production.
-   [ ] A request carrying another user's `fileId` gets a 403, not that
    user's file.
-   [ ] `requestId` and `userId` appear on every API and worker log line
    for a single end-to-end run.
-   [ ] No file bytes are proxied through Vercel.
-   [ ] No GCP client is constructed at module scope.

## The Convert gate

-   [ ] A file that has uploaded and been inspected sits at
    `SCHEMA_READY` and **nothing under `output/` exists**.
-   [ ] Convert before every file has settled returns `409` with a count,
    even when called directly and not through the UI.
-   [ ] Convert with one failed file and the rest ready succeeds, and
    reports the failed one as skipped.
-   [ ] After Convert, `POST /api/updateSchema` returns `409`, not `501`.

## Archives

-   [ ] A dropped `.zip` is expanded in the browser and never uploaded.
-   [ ] Each member becomes its own file row with its own progress and
    its own retry.
-   [ ] Each member carries `zip_parent_name`.
-   [ ] A corrupt archive fails before anything is uploaded.

## Failure classes

-   [ ] Every failure path sets a class from the closed list in §12.4.
-   [ ] Every API error uses the `{ failureClass, message, nextStep }`
    envelope.
-   [ ] No screen renders `error.message` directly.
-   [ ] Non-retryable classes dead-letter immediately rather than
    retrying.
-   [ ] `quota_exhausted` pauses the request and never marks a file
    failed.

## Pub/Sub

-   [ ] Both topics exist.
-   [ ] Both push subscriptions exist and reach only their own service.
-   [ ] Both dead-letter topics and policies exist.
-   [ ] Publishing works on both.
-   [ ] Push authentication works on both.

## Transactional consistency

-   [ ] Stage change, events and outbox row are written in one
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

-   [ ] One worker image builds and runs as either role.
-   [ ] Image exists in Artifact Registry.
-   [ ] **Both** services are deployed from that one image.
-   [ ] Neither service is anonymously invokable.
-   [ ] Each has its own service account with only its own permissions.
-   [ ] The inspect worker **cannot** write to `requests/*/output/`.
-   [ ] The inspect worker holds no model credentials.
-   [ ] `terraform plan` is empty after a pipeline image deploy.
-   [ ] Both workers can read PostgreSQL and read GCS; the convert worker
    can write GCS.

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

-   [ ] §42.1 single-file path passes, **including step 11** — nothing
    is processed before Convert.
-   [ ] §42.2 archive path passes.
-   [ ] §42.3 recovery path passes — a killed worker's file completes
    anyway, with no human intervention.
-   [ ] Output lands at
    `requests/<requestId>/output/<fileId>/result.txt` and contains:

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
real schema inference          (a placeholder schema IS written, §26.2)
JSON Schema generation
structured extraction
LLM validation
LLM repair
confidence scoring
provenance
evidence panel
row storage and the rows endpoints   (§25.6)
CSV / Excel export and download      (demo only — see below)
rows, evidence, raw text, merge, download   (§0.9 — fixtures on the client)
multi-file semantic processing
complex workflow orchestration
Redis
Kafka
Kubernetes
Elasticsearch
```

Three of those need a sentence each, because they are *partly* in scope
and the boundary matters:

**Schema inference** — no inference, but the inspect worker **does**
write a real `file_schemas` row with a fixed placeholder shape, and the
UI **does** fetch and render it. The whole pre-Convert flow is
exercised; only the intelligence is missing.

**Schema editing** — **in scope.** `POST /api/updateSchema` (§0.5) is
implemented, including the two-edits rule and the apply-to-all scope
check. It moved into this phase when the schema editor became the centre
of the Prepare screen; what stays out is any *intelligence* behind the
edit, since the shape it edits is still a placeholder.

**Download and export** — **out of scope, demo only.** There are no
CSV/Excel export endpoints in this phase. Where a demo needs to show the
worker's output, issue a short-lived signed **read** URL for
`requests/<requestId>/output/<fileId>/result.txt` and nothing more. Do
not build format conversion, a bulk archive, or the pre-download summary
dialog; those belong with real row storage (§25.6), because until rows
exist there is nothing to export.

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
                       register / log in
                                |
                                v
                    +-----------------------+
                    |  Next.js on Vercel    |
                    |  session cookie       |
                    +-----------+-----------+
                                |
        +-----------------------+-----------------------+
        |                       |                       |
        v                       v                       v
 POST /getSignedUrl     POST /upload               POST /convert             
        |                       |                       |
        v                       |                       |
  GCS signed URLs               |                       |
        |                       |                       |
        v            +----------+----------+ +----------+----------+
  browser PUTs       |  PostgreSQL         | |  PostgreSQL         |
  each file          |  stage = UPLOADED   | |  stage = CONVERTING |
        |            |  + outbox row       | |  + outbox row/file  |
        v            |  (one transaction)  | |  (one transaction)  |
     GCS object      +----------+----------+ +----------+----------+
        |                       |                       |
        |                       v                       v
        |            <prefix>-file-uploaded   <prefix>-convert-requested
        |                       |                       |
        |                 authenticated push      authenticated push
        |                       |                       |
        |                       v                       v
        |            +-------------------+   +-------------------+
        |            |   Cloud Run       |   |   Cloud Run       |
        |            |   INSPECT WORKER  |   |   CONVERT WORKER  |
        |            |                   |   |                   |
        +----------->|  reads the file   |   |  reads the file   |<---+
                     |  writes schema    |   |  writes output    |    |
                     |  SCHEMA_READY     |   |  COMPLETED        |    |
                     +---------+---------+   +---------+---------+    |
                               |                       |              |
                               v                       v              |
                         file_schemas            GCS output           |
                               |                       |              |
                               v                       v              |
                    GET /files/:id/schemas      result.txt            |
                               |                                      |
                               v                                      |
                    ┌────────────────────────┐                        |
                    │  the user sees the     │                        |
                    │  shape and presses     │                        |
                    │  CONVERT               │                        |
                    └────────────────────────┘                        |
                                                                      |
     Cloud Scheduler ── every minute ──> POST /internal/sweep ─────────+
                                          relay · reaper · resume
```

Two triggers, two services, one gate between them, and a timer
underneath that makes the whole thing self-healing.

**What the next phase replaces:** `processors/inspect.py` becomes real
schema inference, and `processors/convert.py` becomes the extraction
engine. The Cloud Run boundary, both Pub/Sub contracts, the PostgreSQL
model, the GCS layout, the failure classes and every Next.js API contract
stay exactly as they are while that happens — which is the entire point
of building them first.
