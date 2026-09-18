-- ============================================================ table_merges
--
-- Several finished tables presented as one. A merge holds no rows: its
-- members' records stay where the worker wrote them and the union happens on
-- read, which is what makes a merge undoable without moving any data.

CREATE TABLE "table_merges" (
  "id"         TEXT           NOT NULL,
  "request_id" TEXT           NOT NULL,
  "user_id"    TEXT           NOT NULL,
  "name"       TEXT           NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "table_merges_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "table_merges"
  ADD CONSTRAINT "table_merges_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- [NOT IN PRISMA] A merge of one table is not a merge, and an unnamed one has
-- nothing to show in the list it replaces its members in.
ALTER TABLE "table_merges"
  ADD CONSTRAINT "table_merges_name_chk"
  CHECK (length(btrim("name")) BETWEEN 1 AND 120);

CREATE INDEX "table_merges_request_idx" ON "table_merges" ("request_id");

-- ===================================================== table_merge_members

CREATE TABLE "table_merge_members" (
  "merge_id"       TEXT    NOT NULL,
  "file_schema_id" TEXT    NOT NULL,
  "ord"            INTEGER NOT NULL,

  -- The schema id is the primary key, not merely unique: a table belongs to at
  -- most one merge, and that is a database guarantee rather than a check the
  -- service has to remember to run.
  CONSTRAINT "table_merge_members_pkey" PRIMARY KEY ("file_schema_id")
);

ALTER TABLE "table_merge_members"
  ADD CONSTRAINT "table_merge_members_merge_id_fkey"
  FOREIGN KEY ("merge_id") REFERENCES "table_merges"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "table_merge_members"
  ADD CONSTRAINT "table_merge_members_file_schema_id_fkey"
  FOREIGN KEY ("file_schema_id") REFERENCES "file_schemas"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "table_merge_members_ord_uq"
  ON "table_merge_members" ("merge_id", "ord");

CREATE INDEX "table_merge_members_merge_idx"
  ON "table_merge_members" ("merge_id");
