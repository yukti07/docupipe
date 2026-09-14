import "server-only"

import type { PoolClient } from "pg"

import type { FailureClass, FieldType } from "@/lib/api/types"
import { query, queryOne } from "./client"

/**
 * Data access. Explicit SQL and explicit row types.
 *
 * Every function that mutates takes a `tx`, because every mutation in this
 * system belongs in a transaction with the event and outbox rows that describe
 * it. Reads take the pool.
 */

/* ------------------------------------------------------------------ rows */

export type FileStage =
  | "UPLOADING"
  | "UPLOADED"
  | "INSPECTING"
  | "SCHEMA_READY"
  | "CONVERTING"
  | "COMPLETED"
  | "FAILED"

export type RequestStatus =
  | "COLLECTING"
  | "READY"
  | "CONVERTING"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED"

export type TableStage = "QUEUED" | "EXTRACTING" | "FILLING" | "DONE" | "FAILED"

export type RequestRow = {
  id: string
  user_id: string
  status: RequestStatus
  file_count: number
  converted_at: Date | null
  paused_until: Date | null
}

export type FileRow = {
  id: string
  request_id: string
  user_id: string
  original_filename: string
  content_type: string | null
  bucket: string | null
  object_key: string | null
  stage: FileStage
  failure_class: FailureClass | null
  failure_detail: string | null
}

export type SchemaRow = {
  id: string
  file_id: string
  request_id: string
  table_ord: number
  table_label: string | null
  version: number
  fields: SchemaFieldJson[]
  original_fields: SchemaFieldJson[]
  shape_hash: string
}

export type SchemaFieldJson = {
  key: string
  label: string
  type: FieldType
  required?: boolean
  origin: "detected" | "added"
}

export type ResultRow = {
  file_schema_id: string
  file_id: string
  stage: TableStage
  row_count: number
  field_count: number | null
  to_check_count: number
  progress_unit: string | null
  progress_at: number | null
  progress_of: number | null
  failure_class: FailureClass | null
  failure_detail: string | null
}

/* ----------------------------------------------------------------- users */

export async function upsertUser(tx: PoolClient, userId: string): Promise<void> {
  // Registering an id that already exists is a SUCCESS, not a collision: it is
  // how the same person reaches their workspace from a second browser.
  await tx.query(
    `INSERT INTO users (id, created_at, updated_at, last_seen_at)
     VALUES ($1, now(), now(), now())
     ON CONFLICT (id) DO UPDATE SET last_seen_at = now(), updated_at = now()`,
    [userId],
  )
}

export async function ensureAllowance(
  tx: PoolClient,
  userId: string,
  dailyLimit: number,
): Promise<void> {
  await tx.query(
    `INSERT INTO user_allowance (user_id, used, daily_limit, resets_at, updated_at)
     VALUES ($1, 0, $2, date_trunc('day', now()) + interval '1 day', now())
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, dailyLimit],
  )
}

export type AllowanceRow = { used: number; daily_limit: number; resets_at: Date }

export async function getAllowance(userId: string): Promise<AllowanceRow | null> {
  return queryOne<AllowanceRow>(
    `SELECT used, daily_limit, resets_at FROM user_allowance WHERE user_id = $1`,
    [userId],
  )
}

/* -------------------------------------------------------------- requests */

export async function getRequest(
  requestId: string,
  userId: string,
): Promise<RequestRow | null> {
  // Scoped by user_id in the WHERE clause rather than checked afterwards, so
  // there is no path where a row is loaded and the check is forgotten.
  return queryOne<RequestRow>(
    `SELECT id, user_id, status, file_count, converted_at, paused_until
       FROM requests WHERE id = $1 AND user_id = $2`,
    [requestId, userId],
  )
}

export async function createRequestIfAbsent(
  tx: PoolClient,
  requestId: string,
  userId: string,
): Promise<RequestRow> {
  await tx.query(
    `INSERT INTO requests (id, user_id, status, file_count, created_at, updated_at)
     VALUES ($1, $2, 'COLLECTING', 0, now(), now())
     ON CONFLICT (id) DO NOTHING`,
    [requestId, userId],
  )

  const { rows } = await tx.query<RequestRow>(
    `SELECT id, user_id, status, file_count, converted_at, paused_until
       FROM requests WHERE id = $1`,
    [requestId],
  )
  return rows[0]
}

export async function refreshRequestStatus(
  tx: PoolClient,
  requestId: string,
): Promise<void> {
  // READY is the Convert gate, and "settled" means SCHEMA_READY **or** FAILED —
  // one unreadable file must not hold fifty good ones hostage. Computed here so
  // the gate has exactly one definition, shared with the worker's copy.
  await tx.query(
    `WITH counts AS (
       SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE stage IN ('SCHEMA_READY','FAILED')) AS settled,
              COUNT(*) FILTER (WHERE stage IN ('COMPLETED','FAILED'))    AS terminal,
              COUNT(*) FILTER (WHERE stage = 'FAILED')                   AS failed
         FROM files
        WHERE request_id = $1 AND deleted_at IS NULL
     )
     UPDATE requests r
        SET status = CAST(CASE
              WHEN r.converted_at IS NOT NULL AND c.terminal = c.total AND c.failed = c.total THEN 'FAILED'
              WHEN r.converted_at IS NOT NULL AND c.terminal = c.total THEN 'COMPLETED'
              WHEN r.converted_at IS NOT NULL THEN 'CONVERTING'
              WHEN c.settled = c.total AND c.total > 0 THEN 'READY'
              ELSE 'COLLECTING'
            END AS request_status),
            file_count = c.total,
            updated_at = now()
       FROM counts c
      WHERE r.id = $1 AND r.status <> 'PAUSED'`,
    [requestId],
  )
}

/* ----------------------------------------------------------------- files */

export async function insertFile(
  tx: PoolClient,
  row: {
    id: string
    requestId: string
    userId: string
    filename: string
    contentType: string
    bucket: string
    objectKey: string
    fileLocation: string | null
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO files
       (id, request_id, user_id, original_filename, content_type,
        bucket, object_key, file_location, stage, attempts, max_attempts,
        created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'UPLOADING', 0, 5, now(), now())
     ON CONFLICT (id) DO NOTHING`,
    [
      row.id,
      row.requestId,
      row.userId,
      row.filename,
      row.contentType,
      row.bucket,
      row.objectKey,
      row.fileLocation,
    ],
  )
}

export async function listFiles(requestId: string): Promise<FileRow[]> {
  return query<FileRow>(
    `SELECT id, request_id, user_id, original_filename, content_type,
            bucket, object_key, stage, failure_class, failure_detail
       FROM files
      WHERE request_id = $1 AND deleted_at IS NULL
      ORDER BY created_at, id`,
    [requestId],
  )
}

export async function getFileForUser(
  tx: PoolClient,
  fileId: string,
  userId: string,
): Promise<FileRow | null> {
  const { rows } = await tx.query<FileRow>(
    `SELECT id, request_id, user_id, original_filename, content_type,
            bucket, object_key, stage, failure_class, failure_detail
       FROM files WHERE id = $1 AND user_id = $2`,
    [fileId, userId],
  )
  return rows[0] ?? null
}

/**
 * The client's own path for the file (`webkitRelativePath` for a folder drop).
 * Display only — the server must never try to resolve it, because it is a path
 * on somebody else's machine.
 */
export async function setFileLocation(
  tx: PoolClient,
  fileId: string,
  location: string,
): Promise<void> {
  await tx.query(
    `UPDATE files SET file_location = $2, updated_at = now() WHERE id = $1`,
    [fileId, location.slice(0, 1024)],
  )
}

export async function markUploaded(
  tx: PoolClient,
  fileId: string,
  meta: { generation: string | null; checksum: string | null; sizeBytes: number },
): Promise<void> {
  await tx.query(
    `UPDATE files
        SET stage = 'UPLOADED',
            generation = $2, checksum = $3, size_bytes = $4,
            uploaded_at = now(), updated_at = now()
      WHERE id = $1 AND stage = 'UPLOADING'`,
    [fileId, meta.generation, meta.checksum, meta.sizeBytes],
  )
}

export async function failFile(
  tx: PoolClient,
  fileId: string,
  failureClass: FailureClass,
  detail: string | null,
): Promise<void> {
  await tx.query(
    `UPDATE files
        SET stage = 'FAILED', failure_class = $2, failure_detail = $3, updated_at = now()
      WHERE id = $1`,
    [fileId, failureClass, detail?.slice(0, 2000) ?? null],
  )
}

/** Moves every settled-ready file into CONVERTING. Returns the ids moved. */
export async function startConverting(
  tx: PoolClient,
  requestId: string,
): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(
    `UPDATE files
        SET stage = 'CONVERTING', updated_at = now()
      WHERE request_id = $1 AND stage = 'SCHEMA_READY'
      RETURNING id`,
    [requestId],
  )
  return rows.map((r) => r.id)
}

/* --------------------------------------------------------------- schemas */

export async function listSchemas(requestId: string): Promise<SchemaRow[]> {
  return query<SchemaRow>(
    `SELECT id, file_id, request_id, table_ord, table_label, version,
            fields, original_fields, shape_hash
       FROM file_schemas
      WHERE request_id = $1
      ORDER BY file_id, table_ord`,
    [requestId],
  )
}

/**
 * How many FILES in this request started out with each shape.
 *
 * Counts distinct files rather than schemas: a spreadsheet with two identical
 * sheets is one file that matches, not two, and the apply-to-all label says
 * "12 files".
 */
export async function shapeCounts(requestId: string): Promise<Map<string, number>> {
  const rows = await query<{ shape_hash: string; files: string }>(
    `SELECT shape_hash, COUNT(DISTINCT file_id)::text AS files
       FROM file_schemas WHERE request_id = $1
      GROUP BY shape_hash`,
    [requestId],
  )
  return new Map(rows.map((r) => [r.shape_hash, Number(r.files)]))
}

export async function getSchemaForUser(
  tx: PoolClient,
  schemaId: string,
  userId: string,
): Promise<(SchemaRow & { request_status: RequestStatus; converted_at: Date | null }) | null> {
  const { rows } = await tx.query<
    SchemaRow & { request_status: RequestStatus; converted_at: Date | null }
  >(
    `SELECT s.id, s.file_id, s.request_id, s.table_ord, s.table_label, s.version,
            s.fields, s.original_fields, s.shape_hash,
            r.status AS request_status, r.converted_at
       FROM file_schemas s
       JOIN requests r ON r.id = s.request_id
      WHERE s.id = $1 AND r.user_id = $2`,
    [schemaId, userId],
  )
  return rows[0] ?? null
}

export async function updateSchemaFields(
  tx: PoolClient,
  schemaId: string,
  fields: SchemaFieldJson[],
): Promise<number> {
  const { rows } = await tx.query<{ version: number }>(
    `UPDATE file_schemas
        SET fields = $2::jsonb, version = version + 1, edited_at = now()
      WHERE id = $1
      RETURNING version`,
    [schemaId, JSON.stringify(fields)],
  )
  return rows[0].version
}

/* --------------------------------------------------------------- results */

export async function listResults(requestId: string): Promise<ResultRow[]> {
  return query<ResultRow>(
    `SELECT file_schema_id, file_id, stage, row_count, field_count, to_check_count,
            progress_unit, progress_at, progress_of, failure_class, failure_detail
       FROM file_schema_results
      WHERE request_id = $1`,
    [requestId],
  )
}

/* ---------------------------------------------------------------- events */

export async function recordEvent(
  tx: PoolClient,
  event: {
    requestId: string
    userId: string
    fileId?: string | null
    type: string
    message?: string | null
    metadata?: Record<string, unknown> | null
    traceId?: string | null
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO file_events
       (request_id, file_id, user_id, request_trace_id, event_type, message, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())`,
    [
      event.requestId,
      event.fileId ?? null,
      event.userId,
      event.traceId ?? null,
      event.type,
      event.message ?? null,
      event.metadata ? JSON.stringify(event.metadata) : null,
    ],
  )
}

/* ---------------------------------------------------------------- outbox */

/**
 * Write a PENDING outbox row.
 *
 * MUST be in the same transaction as the state change it announces. If the
 * inline publish afterwards fails, the row is still committed and the worker's
 * sweep picks it up — which is why a publish failure never fails the request.
 */
export async function enqueue(
  tx: PoolClient,
  row: { requestId: string; fileId?: string | null; topic: string; payload: unknown },
): Promise<number> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO request_outbox
       (request_id, file_id, topic, payload, status, attempts, next_attempt_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, 'PENDING', 0, now(), now(), now())
     RETURNING id`,
    [row.requestId, row.fileId ?? null, row.topic, JSON.stringify(row.payload)],
  )
  return Number(rows[0].id)
}

export async function markOutboxPublished(ids: number[]): Promise<void> {
  if (ids.length === 0) return
  await query(
    `UPDATE request_outbox
        SET status = 'PUBLISHED', published_at = now(), updated_at = now()
      WHERE id = ANY($1::bigint[])`,
    [ids],
  )
}
