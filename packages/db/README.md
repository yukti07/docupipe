# Quarry database

**The single owner of the Postgres schema.** Prisma writes the migrations.
The Python worker reads and writes through SQLAlchemy Core and never migrates
and never autogenerates — two migration tools pointed at one database is the
standard way to lose a column.

```bash
npm install
npx prisma migrate deploy      # apply, where a DATABASE_URL exists
npx prisma migrate dev         # author a new migration
npx prisma generate            # regenerate the client
npx prisma studio              # browse
```

## Applying to Cloud SQL

`prisma migrate deploy` takes a connection URL, and reaching Cloud SQL without
a public allowlist means the connector, which supplies a socket rather than a
URL. `scripts/migrate.mjs` closes that gap without needing the
`cloud-sql-proxy` binary:

```bash
export INSTANCE_CONNECTION_NAME=project:region:instance
export DB_NAME=...  DB_USER=...  DB_PASSWORD=...
gcloud auth application-default login

npm run migrate:status      # what is applied
npm run migrate:dry-run     # what would be applied
npm run migrate:cloudsql    # apply
```

It writes Prisma's own `_prisma_migrations` table with Prisma's checksum, so
`prisma migrate status` agrees with it afterwards and a later
`prisma migrate deploy` correctly sees nothing to do. One transaction per
migration, so a failure leaves the database exactly as it was. It refuses to
re-run a migration whose file has changed since it was applied, and says so —
edit forward with a new migration instead.

## Tables

```
users ──< requests ──< files ──< file_schemas ──< file_schema_results
             │           │
             │           └──< file_events
             └──< request_outbox
```

| Table | What it is |
|---|---|
| `users` | The browser-generated client id. No password, no email — the id groups everything a person owns |
| `requests` | One submission. `id` is the client-generated `requestId` from the payload |
| `files` | **The unit of work.** Its own stage, its own lease, its own failure |
| `file_schemas` | One per *table* found inside a file. A three-sheet spreadsheet gets three |
| `file_schema_results` | Per-table progress and counts |
| `file_events` | Audit trail |
| `request_outbox` | The transactional outbox |
| `user_allowance` | Pages used against the cap, and when it resets |

## Constraints that are not in `schema.prisma`

Prisma cannot express these, so they live only in the migration SQL. They are
load-bearing — do not drop them when regenerating.

| Constraint | Why |
|---|---|
| `users_id_format_chk` | The id is a bearer capability: whoever holds it holds the workspace. The entropy rule is the whole defence, so it is enforced rather than assumed of the client |
| `files_failure_matches_stage_chk` | Makes "every failure has a class" a database guarantee. You cannot write a FAILED row without one, and you cannot leave a stale class on a row that recovered |
| `requests_paused_has_time_chk` | PAUSED must carry a resume time. "Paused with no time" renders as a stall |
| `files_object_key_uq` | Partial unique — two file rows must never point at the same object, but the key is NULL until a URL is signed |
| `outbox_relay_idx` | Partial index. The relay only asks for PENDING, and PUBLISHED rows accumulate forever |

## Decisions made here that the plan leaves open

**`file_schema_results` is not in the plan.** `/api/polling/result` returns
per-`(fileId, schemaId)` stage, `rowCount`, `fieldCount` and `toCheckCount`,
and `files.stage` is *one column on the file*. A three-sheet spreadsheet is
one file row and three schema rows, so there was nowhere to put any of it, and
the five `counts` could not sum to the number of tables. **Alternative if you
would rather not have the table:** define `counts` as per-file and drop
`rowCount`/`toCheckCount` from the payload until rows exist.

**`failure_class` is canonical, and mirrored in three other files.** The
frontend's list won — it was already wired through `FailureMessage`, the copy
map, tone and `blocksConvert` — plus three operational classes
(`processing_failed`, `max_attempts`, `internal`) for failures that belong to
the worker rather than to the document. `network` and `unknown` are client-only
and deliberately absent.

Keep it identical to `packages/worker/src/failures.py`,
`packages/web/src/lib/api/types.ts` and `packages/web/src/lib/api/http.ts`.
`packages/worker/tests/test_contract_drift.py` enforces it.

**`requests.id` is the client-generated value, used as the primary key.** Two
users picking `req_1` collide. It is *safe* — the ownership check returns 403
— but it leaks the existence of another user's request and makes idempotency
cross-tenant. The cleaner fix is a surrogate key with
`UNIQUE (user_id, client_request_id)`, at the cost of the API mapping between
them.

**`file_schemas.request_id` is denormalised.** `matchingFileCount` is scoped
to a request, so without it that count is a join plus a scan on every poll
instead of one index hit.

Two smaller ones: `requests.format` has no source any more (§0.2 sends
filenames only), and `files.file_location` is in `/api/upload` but not in §12
— it is stored, display-only, and the server must never try to resolve it,
because it is a path on another machine.
