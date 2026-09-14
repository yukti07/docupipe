-- Quarry — initial schema.
--
-- Seven tables, five enums. Nothing here stores file bytes, and nothing here
-- stores extracted rows yet.
--
--   users ──< requests ──< files ──< file_schemas ──< file_schema_results
--                │           │
--                │           └──< file_events
--                └──< request_outbox
--
-- Constraints marked [NOT IN PRISMA] cannot be expressed in schema.prisma and
-- exist only here. They are load-bearing. Do not drop them when regenerating.

-- ============================================================ enums

CREATE TYPE "request_status" AS ENUM (
  'COLLECTING', 'READY', 'CONVERTING', 'PAUSED', 'COMPLETED', 'FAILED'
);

CREATE TYPE "file_stage" AS ENUM (
  'UPLOADING', 'UPLOADED', 'INSPECTING', 'SCHEMA_READY',
  'CONVERTING', 'COMPLETED', 'FAILED'
);

CREATE TYPE "table_stage" AS ENUM (
  'QUEUED', 'EXTRACTING', 'FILLING', 'DONE', 'FAILED'
);

CREATE TYPE "outbox_status" AS ENUM ('PENDING', 'PUBLISHED', 'DEAD');

-- CANONICAL. Identical to packages/web/src/lib/api/types.ts (FailureClass),
-- packages/web/src/lib/api/http.ts (KNOWN) and
-- packages/worker/src/failures.py (FailureClass).
--
-- This is product semantics living in two languages, so it drifts without
-- anyone noticing: a class the server writes but the client's set omits
-- renders as "unknown", which is a worse sentence than the one we had.
--
-- `network` and `unknown` are deliberately absent — they are client-side
-- states and the server never sends them.
CREATE TYPE "failure_class" AS ENUM (
  -- acquisition
  'acquisition', 'empty_file', 'too_large', 'archive_not_expanded',
  -- format
  'format_unsupported', 'format_corrupt', 'format_locked',
  -- reading a shape
  'extract_empty', 'schema_not_found', 'schema_inference_failed',
  -- the model, and the allowance
  'provider_quota_exhausted', 'provider_refused', 'response_unparseable',
  'budget_exceeded',
  -- per-value, set during verification
  'field_unresolved', 'field_unsupported_by_evidence', 'verification_failed',
  -- API-level only, never stored on a file row
  'gate_not_met', 'merge_incompatible',
  -- operational, the worker's own failures
  'processing_failed', 'max_attempts', 'internal'
);

-- ============================================================ users

CREATE TABLE "users" (
  "id"            TEXT        NOT NULL,
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "last_seen_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- [NOT IN PRISMA] The entropy rule from §12.1, enforced server-side rather
-- than assumed of the client. The id is a bearer capability: whoever holds it
-- holds the workspace, so this constraint is the whole defence.
ALTER TABLE "users"
  ADD CONSTRAINT "users_id_format_chk"
  CHECK ("id" ~ '^[A-Za-z0-9_-]{22,64}$');

-- ====================================================== user_allowance

-- What /api/polling/result returns as allowance: { used, limit, resetsAt },
-- and what the Settings cap is read from. The UI already has AllowanceMeter
-- and RaiseCapDialog built against those fields.
--
-- The small, per-user form of the budget ledger: enough to answer "how much is
-- left" and to enforce a cap BEFORE a request is issued rather than after,
-- which is the only point at which enforcing it does anything. Per-provider
-- spend accounting belongs with the real extraction engine.

CREATE TABLE "user_allowance" (
  "user_id"      TEXT           NOT NULL,
  "used"         INTEGER        NOT NULL DEFAULT 0,
  "daily_limit"  INTEGER        NOT NULL DEFAULT 5000,
  "resets_at"    TIMESTAMPTZ(6) NOT NULL,
  "updated_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "user_allowance_pkey" PRIMARY KEY ("user_id")
);

-- [NOT IN PRISMA] A negative balance means something double-counted, and it
-- is much easier to find here than three screens away.
ALTER TABLE "user_allowance"
  ADD CONSTRAINT "user_allowance_used_chk"
  CHECK ("used" >= 0 AND "daily_limit" >= 0);

-- ============================================================ requests

CREATE TABLE "requests" (
  "id"            TEXT             NOT NULL,
  "user_id"       TEXT             NOT NULL,

  "status"        "request_status" NOT NULL DEFAULT 'COLLECTING',
  "format"        TEXT,
  "file_count"    INTEGER          NOT NULL DEFAULT 0,

  "created_at"    TIMESTAMPTZ(6)   NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ(6)   NOT NULL DEFAULT now(),
  "converted_at"  TIMESTAMPTZ(6),
  "paused_until"  TIMESTAMPTZ(6),
  "error_code"    TEXT,

  CONSTRAINT "requests_pkey" PRIMARY KEY ("id")
);

-- [NOT IN PRISMA] requestId is client-generated (§0.2), so it is worth
-- refusing obvious junk before it becomes a primary key.
ALTER TABLE "requests"
  ADD CONSTRAINT "requests_id_format_chk"
  CHECK ("id" ~ '^[A-Za-z0-9_-]{8,64}$');

-- [NOT IN PRISMA] PAUSED is the only status that may carry a resume time,
-- and it must carry one — "paused with no time" renders as a stall.
ALTER TABLE "requests"
  ADD CONSTRAINT "requests_paused_has_time_chk"
  CHECK (("status" = 'PAUSED') = ("paused_until" IS NOT NULL));

CREATE INDEX "requests_user_created_idx"
  ON "requests" ("user_id", "created_at" DESC);

-- ============================================================ files

CREATE TABLE "files" (
  "id"                     TEXT           NOT NULL,
  "request_id"             TEXT           NOT NULL,
  "user_id"                TEXT           NOT NULL,

  "original_filename"      TEXT           NOT NULL,
  "content_type"           TEXT,
  "detected_content_type"  TEXT,
  "size_bytes"             BIGINT,

  "bucket"                 TEXT,
  "object_key"             TEXT,
  "generation"             BIGINT,
  "checksum"               TEXT,

  "file_location"          TEXT,
  "zip_parent_name"        TEXT,

  "stage"                  "file_stage"   NOT NULL DEFAULT 'UPLOADING',
  "attempts"               INTEGER        NOT NULL DEFAULT 0,
  "max_attempts"           INTEGER        NOT NULL DEFAULT 5,
  "claimed_by"             TEXT,
  "claimed_until"          TIMESTAMPTZ(6),

  "failure_class"          "failure_class",
  "failure_detail"         TEXT,

  "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "uploaded_at"            TIMESTAMPTZ(6),
  "updated_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deleted_at"             TIMESTAMPTZ(6),

  CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- [NOT IN PRISMA] "Every failure has a class" as a database guarantee rather
-- than a convention. You cannot write a FAILED row without one, and you cannot
-- leave a stale class on a row that recovered.
ALTER TABLE "files"
  ADD CONSTRAINT "files_failure_matches_stage_chk"
  CHECK (("stage" = 'FAILED') = ("failure_class" IS NOT NULL));

-- [NOT IN PRISMA] Partial unique: two file rows must never point at the same
-- object, but object_key is NULL until a URL is signed.
CREATE UNIQUE INDEX "files_object_key_uq"
  ON "files" ("bucket", "object_key")
  WHERE "object_key" IS NOT NULL;

CREATE INDEX "files_request_idx"      ON "files" ("request_id");
CREATE INDEX "files_user_created_idx" ON "files" ("user_id", "created_at" DESC);

-- The sweep's only query, run every 60 seconds forever. Without this it is a
-- sequential scan on a growing table once a minute.
CREATE INDEX "files_reaper_idx"       ON "files" ("stage", "claimed_until");

-- ============================================================ file_schemas

CREATE TABLE "file_schemas" (
  "id"               TEXT           NOT NULL,
  "file_id"          TEXT           NOT NULL,
  "request_id"       TEXT           NOT NULL,

  "table_ord"        INTEGER        NOT NULL,
  "table_label"      TEXT,
  "version"          INTEGER        NOT NULL DEFAULT 1,

  "fields"           JSONB          NOT NULL,
  "original_fields"  JSONB          NOT NULL,
  "shape_hash"       TEXT           NOT NULL,

  "edited_at"        TIMESTAMPTZ(6),
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "file_schemas_pkey" PRIMARY KEY ("id")
);

-- This is what makes the inspect worker's "write every schema for a file in
-- ONE transaction" safe to retry: a redelivery conflicts instead of
-- duplicating. §0.4's delta poll depends on all-or-nothing per file.
CREATE UNIQUE INDEX "file_schemas_file_ord_uq"
  ON "file_schemas" ("file_id", "table_ord");

-- matchingFileCount (§0.4) is scoped to a request, so request_id is
-- denormalised onto this table to make it one index hit per poll.
CREATE INDEX "file_schemas_shape_idx"
  ON "file_schemas" ("request_id", "shape_hash");

-- ====================================================== file_schema_results

CREATE TABLE "file_schema_results" (
  "file_schema_id"  TEXT           NOT NULL,
  "file_id"         TEXT           NOT NULL,
  "request_id"      TEXT           NOT NULL,

  "stage"           "table_stage"  NOT NULL DEFAULT 'QUEUED',
  "row_count"       INTEGER        NOT NULL DEFAULT 0,
  "field_count"     INTEGER,
  "to_check_count"  INTEGER        NOT NULL DEFAULT 0,

  "progress_unit"   TEXT,
  "progress_at"     INTEGER,
  "progress_of"     INTEGER,

  "failure_class"   "failure_class",
  "failure_detail"  TEXT,

  "started_at"      TIMESTAMPTZ(6),
  "completed_at"    TIMESTAMPTZ(6),
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "file_schema_results_pkey" PRIMARY KEY ("file_schema_id")
);

-- The five counts in §0.7 must sum to the number of TABLES in the request.
-- This index is what makes that one grouped query per poll instead of five.
CREATE INDEX "fsr_request_stage_idx"
  ON "file_schema_results" ("request_id", "stage");

-- ============================================================ file_events

CREATE TABLE "file_events" (
  "id"                BIGSERIAL      NOT NULL,
  "request_id"        TEXT           NOT NULL,
  "file_id"           TEXT,
  "user_id"           TEXT           NOT NULL,
  "request_trace_id"  TEXT,
  "event_type"        TEXT           NOT NULL,
  "message"           TEXT,
  "metadata"          JSONB,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "file_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "file_events_request_idx" ON "file_events" ("request_id", "id");
CREATE INDEX "file_events_trace_idx"   ON "file_events" ("request_trace_id");
CREATE INDEX "file_events_user_idx"    ON "file_events" ("user_id", "created_at" DESC);

-- ========================================================== request_outbox

CREATE TABLE "request_outbox" (
  "id"               BIGSERIAL       NOT NULL,
  "request_id"       TEXT            NOT NULL,
  "file_id"          TEXT,

  "topic"            TEXT            NOT NULL,
  "payload"          JSONB           NOT NULL,

  "status"           "outbox_status" NOT NULL DEFAULT 'PENDING',
  "attempts"         INTEGER         NOT NULL DEFAULT 0,
  "next_attempt_at"  TIMESTAMPTZ(6)  NOT NULL DEFAULT now(),
  "last_error"       TEXT,
  "published_at"     TIMESTAMPTZ(6),

  "created_at"       TIMESTAMPTZ(6)  NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ(6)  NOT NULL DEFAULT now(),

  CONSTRAINT "request_outbox_pkey" PRIMARY KEY ("id")
);

-- [NOT IN PRISMA] Partial index. The relay only ever asks for PENDING, and
-- PUBLISHED rows accumulate forever — this keeps the index the size of the
-- backlog rather than the size of the history.
CREATE INDEX "outbox_relay_idx"
  ON "request_outbox" ("next_attempt_at")
  WHERE "status" = 'PENDING';

-- ============================================================ foreign keys

ALTER TABLE "user_allowance"
  ADD CONSTRAINT "user_allowance_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "requests"
  ADD CONSTRAINT "requests_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "files"
  ADD CONSTRAINT "files_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "files"
  ADD CONSTRAINT "files_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "file_schemas"
  ADD CONSTRAINT "file_schemas_file_id_fkey"
  FOREIGN KEY ("file_id") REFERENCES "files"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "file_schemas"
  ADD CONSTRAINT "file_schemas_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "file_schema_results"
  ADD CONSTRAINT "file_schema_results_file_schema_id_fkey"
  FOREIGN KEY ("file_schema_id") REFERENCES "file_schemas"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "file_schema_results"
  ADD CONSTRAINT "file_schema_results_file_id_fkey"
  FOREIGN KEY ("file_id") REFERENCES "files"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "file_schema_results"
  ADD CONSTRAINT "file_schema_results_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "file_events"
  ADD CONSTRAINT "file_events_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "file_events"
  ADD CONSTRAINT "file_events_file_id_fkey"
  FOREIGN KEY ("file_id") REFERENCES "files"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "file_events"
  ADD CONSTRAINT "file_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "request_outbox"
  ADD CONSTRAINT "request_outbox_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "request_outbox"
  ADD CONSTRAINT "request_outbox_file_id_fkey"
  FOREIGN KEY ("file_id") REFERENCES "files"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
