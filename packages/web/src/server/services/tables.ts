import "server-only"

import type { CellValue, SchemaField, TableData, TableRow } from "@/lib/api/types"
import { isMergeId } from "@/lib/merge"
import { query, queryOne } from "../db/client"
import type { SchemaFieldJson } from "../db/repos"
import { fail } from "../handler"

/**
 * §0.9 — the table screen, reading what the processing worker actually wrote.
 *
 * Three of the four tables this reads (`processing_runs`, `record_errors` and
 * the per-file record tables) are owned by the Python workers and are NOT in
 * the Prisma schema, so they are read here rather than through `repos.ts`,
 * which is the data access for the tables `packages/db` owns. Keeping that
 * boundary visible is the point: if those tables are ever adopted into Prisma,
 * this is the one file that moves.
 */

/**
 * Every row in one response, because `TableData` has no pagination and the
 * download button writes its CSV from the same array. A table past this is
 * refused rather than quietly cut in half — a truncated download that says
 * nothing about being truncated is the worst of the three outcomes.
 */
const MAX_ROWS = 10_000

type Target = {
  file_id: string
  original_filename: string
  table_label: string | null
  fields: SchemaFieldJson[]
  schemas_for_file: number
  record_table: string | null
}

export type RecordRow = {
  id: string
  record_number: number
  status: string
  data: Record<string, unknown> | null
}

export type RecordErrorRow = {
  record_number: number
  field_name: string | null
  message: string
}

export async function getTable(
  userId: string,
  requestId: string,
  schemaId: string,
): Promise<TableData> {
  if (isMergeId(schemaId)) return getMergedTable(userId, requestId, schemaId)

  const { target, records, errors } = await loadOne(userId, requestId, schemaId)

  return toTableData({
    requestId,
    schemaId,
    fileId: target.file_id,
    fileName: target.original_filename,
    tableLabel: target.table_label ?? target.original_filename,
    fields: target.fields,
    records,
    errors,
  })
}

/**
 * Several tables under one another, with a column saying which one each row
 * came from.
 *
 * The union is done here rather than in SQL because the members live in
 * separate physical tables — one per file, named from a hash of the file id —
 * and a UNION across them would have to be built by string concatenation
 * anyway. Reading them one at a time costs a round trip per member and keeps
 * every ownership check in the one place that already does it.
 *
 * The fields are the first member's. Every member was checked to have the same
 * shape when the merge was written, so any of them would do.
 */
async function getMergedTable(
  userId: string,
  requestId: string,
  mergeId: string,
): Promise<TableData> {
  const merge = await queryOne<{ name: string }>(
    `SELECT name FROM table_merges WHERE id = $1 AND request_id = $2 AND user_id = $3`,
    [mergeId, requestId, userId],
  )
  if (!merge) throw fail("schema_not_found", "We don't have a record of that merged table.")

  const members = await query<{ file_schema_id: string }>(
    `SELECT file_schema_id FROM table_merge_members WHERE merge_id = $1 ORDER BY ord`,
    [mergeId],
  )

  const rows: TableRow[] = []
  let fields: SchemaFieldJson[] = []

  for (const member of members) {
    const part = await loadOne(userId, requestId, member.file_schema_id)
    if (fields.length === 0) fields = part.target.fields

    const source = `${part.target.original_filename} · ${
      part.target.table_label ?? "table 1"
    }`

    const table = toTableData({
      requestId,
      schemaId: member.file_schema_id,
      fileId: part.target.file_id,
      fileName: part.target.original_filename,
      tableLabel: source,
      fields,
      records: part.records,
      errors: part.errors,
    })

    rows.push(...table.rows.map((row) => ({ ...row, sourceFile: source })))

    // The cap is per table, so nineteen tables of ten thousand rows each would
    // pass every individual check and still come back as a hundred and ninety
    // thousand. Refused on the same terms as a single table past the cap,
    // rather than quietly cut short.
    if (rows.length > MAX_ROWS) {
      throw fail(
        "too_large",
        `These tables come to more than ${MAX_ROWS.toLocaleString()} rows together, which is more than this screen can open at once.`,
        { nextStep: "Combine fewer of them, or download them separately." },
      )
    }
  }

  return {
    requestId,
    schemaId: mergeId,
    fileId: mergeId,
    fileName: merge.name,
    tableLabel: merge.name,
    pageRange: null,
    merged: true,
    fields: fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      origin: field.origin,
    })),
    rows,
  }
}

async function loadOne(
  userId: string,
  requestId: string,
  schemaId: string,
): Promise<{ target: Target; records: RecordRow[]; errors: RecordErrorRow[] }> {
  // Each file's records live in a table of their own, which the worker names
  // from sha256(file_id) truncated to 24 hex characters. Deriving that name in
  // SQL rather than in Node keeps one definition instead of two that can
  // drift, and `to_regclass` answers "does it exist" in the same round trip.
  // Ownership is in the WHERE clause, so there is no path where the row is
  // loaded and the check is forgotten.
  const target = await queryOne<Target>(
    `SELECT f.id AS file_id,
            f.original_filename,
            s.table_label,
            s.fields,
            (SELECT count(*) FROM file_schemas s2 WHERE s2.file_id = s.file_id)
              AS schemas_for_file,
            to_regclass('public.structured_records_' ||
                        substr(encode(sha256(f.id::bytea), 'hex'), 1, 24))::text
              AS record_table
       FROM file_schemas s
       JOIN files f ON f.id = s.file_id
       JOIN requests r ON r.id = s.request_id
      WHERE s.id = $1 AND s.request_id = $2 AND r.user_id = $3 AND f.deleted_at IS NULL`,
    [schemaId, requestId, userId],
  )

  if (!target) throw fail("schema_not_found", "We don't have a record of that table.")

  // One record table per FILE, with no column saying which of the file's
  // tables a record belongs to. For one table per file that is unambiguous;
  // for a multi-sheet file it is not, and guessing would put another sheet's
  // rows on screen under this sheet's name.
  if (Number(target.schemas_for_file) > 1) {
    throw fail(
      "merge_incompatible",
      "This file holds more than one table, and its rows aren't separated by table yet.",
    )
  }

  if (!target.record_table) {
    throw fail("processing_failed", "No rows were ever written for this file.")
  }

  const run = await queryOne<{ id: string }>(
    `SELECT id FROM processing_runs
      WHERE file_id = $1 AND status = 'COMPLETED'
      ORDER BY created_at DESC
      LIMIT 1`,
    [target.file_id],
  )

  if (!run) throw fail("processing_failed", "This file hasn't finished processing.")

  // The name came back from `to_regclass`, so it is a table that exists — but
  // it is still interpolated rather than bound, which no other query in this
  // codebase does. The assertion is what makes that safe to read at a glance.
  if (!/^structured_records_[0-9a-f]{24}$/.test(target.record_table)) {
    throw fail("internal", "The record table for this file isn't named as expected.")
  }

  const [records, errors] = await Promise.all([
    query<RecordRow>(
      `SELECT id, record_number, status, data
         FROM ${target.record_table}
        WHERE processing_run_id = $1
        ORDER BY record_number
        LIMIT $2`,
      [run.id, MAX_ROWS + 1],
    ),
    query<RecordErrorRow>(
      `SELECT record_number, field_name, message
         FROM record_errors
        WHERE processing_run_id = $1`,
      [run.id],
    ),
  ])

  // One over the cap was fetched precisely so this can be answered from the
  // rows themselves rather than from a counter that may be stale.
  if (records.length > MAX_ROWS) {
    throw fail(
      "too_large",
      `This table has more than ${MAX_ROWS.toLocaleString()} rows, which is more than this screen can open at once.`,
    )
  }

  return { target, records, errors }
}

/**
 * Rows and their errors, as the table screen reads them. Pure, so the mapping
 * is testable without a database — which is where all the decisions are.
 */
export function toTableData(input: {
  requestId: string
  schemaId: string
  fileId: string
  fileName: string
  tableLabel: string
  fields: SchemaFieldJson[]
  records: RecordRow[]
  errors: RecordErrorRow[]
}): TableData {
  const fieldErrors = new Map<string, string>()
  const rowErrors = new Map<number, string>()

  for (const error of input.errors) {
    if (error.field_name) {
      fieldErrors.set(`${error.record_number}:${error.field_name}`, error.message)
    } else {
      rowErrors.set(error.record_number, error.message)
    }
  }

  const fields: SchemaField[] = input.fields.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    origin: field.origin,
  }))

  const rows: TableRow[] = input.records.map((record) => {
    const data = record.data ?? {}
    const values: Record<string, CellValue> = {}

    for (const field of fields) {
      // Composite rather than stored: nothing writes a per-value row, and this
      // is the only thing that identifies a cell. It stays parseable so that
      // evidence, when there is ever any to show, needs no new column.
      const valueId = `${record.id}:${field.key}`
      const raw = data[field.key]
      const reason = fieldErrors.get(`${record.record_number}:${field.key}`)

      if (reason !== undefined) {
        values[field.key] = { valueId, display: display(raw), state: "marked", reason }
      } else if (raw === undefined || raw === null || raw === "") {
        // A field the schema asks for that this record has no value for —
        // which is also what a schema edited after processing looks like.
        values[field.key] = { valueId, display: "", state: "not-found" }
      } else {
        values[field.key] = { valueId, display: display(raw), state: "value" }
      }
    }

    const failedReason = rowErrors.get(record.record_number)
    const failed = record.status !== "VALID" || failedReason !== undefined

    return {
      recordId: record.id,
      values,
      ...(failed ? { failed: { class: "processing_failed" as const, message: failedReason } } : {}),
    }
  })

  return {
    requestId: input.requestId,
    schemaId: input.schemaId,
    fileId: input.fileId,
    fileName: input.fileName,
    tableLabel: input.tableLabel,
    // Pages belong to documents. A record source has none, and inventing a
    // range would put a number on screen that means nothing.
    pageRange: null,
    fields,
    rows,
  }
}

function display(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.map(display).join(", ")
  return JSON.stringify(value)
}
