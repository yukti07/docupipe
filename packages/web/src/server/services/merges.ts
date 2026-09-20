import "server-only"

import type {
  MergeConflictDetail,
  MergeGroup,
  MergeOverview,
  MergeResult,
  MergeSubmission,
  MergedTable,
  SchemaField,
} from "@/lib/api/types"
import { MERGE_ID_PREFIX, mergeConflicts, shapeHash, shapeKey } from "@/lib/merge"
import { query, transaction } from "../db/client"
import * as repo from "../db/repos"
import type { SchemaFieldJson } from "../db/repos"
import { fail, newId } from "../handler"

/**
 * Combining tables.
 *
 * A merge holds no rows. Its members' records stay exactly where the worker
 * wrote them, and the union happens when the merged table is opened. Two
 * things fall out of that: undoing a merge moves no data, and the batch's row
 * count cannot change when one is made — only its table count can.
 *
 * One submit carries SEVERAL merges. A batch with four tables of one shape and
 * ten of another, where the user wants four of the first combined and two of
 * the second, is one press and one transaction: either both merges are written
 * or neither is.
 */

export type MergeMemberRow = {
  merge_id: string
  merge_name: string
  file_schema_id: string
  ord: number
}

type CandidateRow = {
  schema_id: string
  file_id: string
  original_filename: string
  table_label: string | null
  fields: SchemaFieldJson[]
  row_count: number
  to_check_count: number
  stage: string
  completed_at: Date | null
  merge_id: string | null
}

/** Tables finished, still their own, and the merges already made. */
export async function getMergeOverview(
  userId: string,
  requestId: string,
): Promise<MergeOverview> {
  const request = await repo.getRequest(requestId, userId)
  if (!request) throw fail("internal", "We don't have a record of that request.")

  const candidates = await loadCandidates(requestId)
  const merges = await loadMerges(userId, requestId)

  const free = candidates.filter((row) => row.merge_id === null)
  const groups = groupByShape(free)

  return {
    groups,
    merges,
    // What the results list shows: every unmerged table, plus one per merge.
    tableCount: free.length + merges.length,
  }
}

/**
 * Write several merges at once.
 *
 * Every refusal below is an answer with a 200 and `ok: false`, not an error:
 * the screen has to render the conflict beside the selection that caused it,
 * and a thrown request gives it nothing to render.
 */
export async function createMerges(
  userId: string,
  requestId: string,
  submissions: MergeSubmission[],
  traceId?: string,
): Promise<MergeResult> {
  const request = await repo.getRequest(requestId, userId)
  if (!request) throw fail("internal", "We don't have a record of that request.")

  const candidates = await loadCandidates(requestId)
  const byId = new Map(candidates.map((row) => [row.schema_id, row]))

  const conflicts: MergeConflictDetail[] = []
  const seen = new Set<string>()

  for (const submission of submissions) {
    const rows = submission.schemaIds.map((id) => byId.get(id))

    // Unknown, not-finished and already-merged all mean the same thing to the
    // screen — this table is not available — so they are one refusal with a
    // sentence that says which.
    const unavailable = submission.schemaIds.filter((_id, index) => {
      const row = rows[index]
      return !row || row.stage !== "DONE" || row.merge_id !== null
    })
    if (unavailable.length > 0) {
      return refusal(
        "Some of those tables aren't available to combine any more.",
        "Reload the screen — a table may have been combined or may not have finished.",
      )
    }

    const duplicated = submission.schemaIds.filter((id) => seen.has(id))
    for (const id of submission.schemaIds) seen.add(id)
    if (duplicated.length > 0) {
      return refusal(
        "A table was listed in more than one of those combinations.",
        "A table can only go into one merged table.",
      )
    }

    if (submission.schemaIds.length < 2) {
      return refusal(
        "A merged table needs at least two tables in it.",
        "Tick a second table, or leave this group as it is.",
      )
    }

    const present = rows as CandidateRow[]
    const found = mergeConflicts(
      present.map((row) => ({
        schemaId: row.schema_id,
        tableName: tableNameOf(row),
        fields: toFields(row.fields),
      })),
    )
    if (found.length > 0) {
      const hash = shapeHash(toFields(present[0].fields))
      conflicts.push(...found.map((conflict) => ({ ...conflict, shapeHash: hash })))
    }
  }

  if (conflicts.length > 0) {
    return {
      ok: false,
      failure: {
        class: "merge_incompatible",
        message: "Those tables don't have the same fields.",
        nextStep: "Combining is exact — same field names, same types.",
      },
      conflicts,
    }
  }

  const written = await transaction(async (tx) => {
    const out: MergedTable[] = []

    for (const submission of submissions) {
      const rows = submission.schemaIds.map((id) => byId.get(id)!)
      const mergeId = newId(MERGE_ID_PREFIX.replace(/_$/, ""))
      const name = submission.name.trim().slice(0, 120) || defaultName(rows)

      await tx.query(
        `INSERT INTO table_merges (id, request_id, user_id, name, created_at)
         VALUES ($1, $2, $3, $4, now())`,
        [mergeId, requestId, userId, name],
      )

      for (const [ord, row] of rows.entries()) {
        // ON CONFLICT DO NOTHING would silently drop a member that a
        // concurrent submit had already taken. Letting the primary key raise
        // rolls the whole transaction back instead, which is the honest
        // outcome: nothing was merged, and the screen reloads and says so.
        await tx.query(
          `INSERT INTO table_merge_members (merge_id, file_schema_id, ord)
           VALUES ($1, $2, $3)`,
          [mergeId, row.schema_id, ord],
        )
      }

      await repo.recordEvent(tx, {
        requestId,
        userId,
        type: "TABLES_MERGED",
        message: `${rows.length} tables combined into "${name}".`,
        metadata: { mergeId, schemaIds: submission.schemaIds },
        traceId,
      })

      out.push({
        mergeId,
        name,
        rowCount: rows.reduce((sum, row) => sum + row.row_count, 0),
        tableCount: rows.length,
        shapeHash: shapeHash(toFields(rows[0].fields)),
      })
    }

    return out
  })

  const after = await loadCandidates(requestId)
  const free = after.filter((row) => row.merge_id === null).length
  const merges = await loadMerges(userId, requestId)

  return { ok: true, merges: written, tableCount: free + merges.length }
}

/** Undo. The members come straight back as their own tables — no rows moved. */
export async function deleteMerge(
  userId: string,
  requestId: string,
  mergeId: string,
  traceId?: string,
): Promise<{ status: "ok" }> {
  return transaction(async (tx) => {
    const removed = await tx.query<{ name: string }>(
      `DELETE FROM table_merges
        WHERE id = $1 AND request_id = $2 AND user_id = $3
      RETURNING name`,
      [mergeId, requestId, userId],
    )

    if (removed.rowCount === 0) {
      throw fail("internal", "We don't have a record of that merged table.")
    }

    await repo.recordEvent(tx, {
      requestId,
      userId,
      type: "TABLE_MERGE_REMOVED",
      message: `"${removed.rows[0].name}" was split back into its tables.`,
      metadata: { mergeId },
      traceId,
    })

    return { status: "ok" as const }
  })
}

/**
 * Every merge in a request with its members, for the result poll to fold with.
 * Kept separate from the overview because the poll runs every two seconds and
 * has no use for fields or row counts it already holds.
 */
export async function listMergeMembers(requestId: string): Promise<MergeMemberRow[]> {
  return query<MergeMemberRow>(
    `SELECT m.id AS merge_id, m.name AS merge_name, mm.file_schema_id, mm.ord
       FROM table_merges m
       JOIN table_merge_members mm ON mm.merge_id = m.id
      WHERE m.request_id = $1
      ORDER BY m.created_at, mm.ord`,
    [requestId],
  )
}

/* ------------------------------------------------------------------ */

async function loadCandidates(requestId: string): Promise<CandidateRow[]> {
  return query<CandidateRow>(
    `SELECT s.id AS schema_id,
            f.id AS file_id,
            f.original_filename,
            s.table_label,
            s.fields,
            COALESCE(r.row_count, 0) AS row_count,
            COALESCE(r.to_check_count, 0) AS to_check_count,
            COALESCE(r.stage::text, 'QUEUED') AS stage,
            r.completed_at,
            mm.merge_id
       FROM file_schemas s
       JOIN files f ON f.id = s.file_id
       LEFT JOIN file_schema_results r ON r.file_schema_id = s.id
       LEFT JOIN table_merge_members mm ON mm.file_schema_id = s.id
      WHERE s.request_id = $1 AND f.deleted_at IS NULL
      ORDER BY f.created_at, s.table_ord`,
    [requestId],
  )
}

async function loadMerges(userId: string, requestId: string): Promise<MergedTable[]> {
  const rows = await query<{
    merge_id: string
    name: string
    row_count: number
    table_count: number
    fields: SchemaFieldJson[]
  }>(
    `SELECT m.id AS merge_id,
            m.name,
            COALESCE(sum(r.row_count), 0)::int AS row_count,
            count(*)::int AS table_count,
            (array_agg(s.fields ORDER BY mm.ord))[1] AS fields
       FROM table_merges m
       JOIN table_merge_members mm ON mm.merge_id = m.id
       JOIN file_schemas s ON s.id = mm.file_schema_id
       LEFT JOIN file_schema_results r ON r.file_schema_id = s.id
      WHERE m.request_id = $1 AND m.user_id = $2
      GROUP BY m.id, m.name, m.created_at
      ORDER BY m.created_at`,
    [requestId, userId],
  )

  return rows.map((row) => ({
    mergeId: row.merge_id,
    name: row.name,
    rowCount: row.row_count,
    tableCount: row.table_count,
    shapeHash: shapeHash(toFields(row.fields)),
  }))
}

/**
 * Grouped by the shape each table has NOW, not the one it was detected with.
 * A table edited on the review screen has left the group it started in, and
 * this screen has to agree with that or it offers a combination that refuses.
 */
function groupByShape(rows: CandidateRow[]): MergeGroup[] {
  const byShape = new Map<string, CandidateRow[]>()
  for (const row of rows) {
    if (row.stage !== "DONE") continue
    const key = shapeKey(toFields(row.fields))
    byShape.set(key, [...(byShape.get(key) ?? []), row])
  }

  const groups = [...byShape.values()].map((members) => {
    const fields = toFields(members[0].fields)
    return {
      shapeHash: shapeHash(fields),
      name: groupName(members),
      fields,
      members: members.map((row) => ({
        schemaId: row.schema_id,
        fileId: row.file_id,
        fileName: row.original_filename,
        tableLabel: row.table_label ?? row.original_filename,
        rowCount: row.row_count,
        toCheckCount: row.to_check_count,
        convertedAt: (row.completed_at ?? new Date(0)).toISOString(),
      })),
    }
  })

  // Biggest first: the group most worth combining is the one to land on.
  return groups.sort((a, b) => b.members.length - a.members.length)
}

/**
 * What to call a shape. The label most of its tables already carry, because a
 * name derived from the field list reads like a schema dump and a name taken
 * from one arbitrary file reads like a mistake.
 */
function groupName(members: CandidateRow[]): string {
  const counts = new Map<string, number>()
  for (const row of members) {
    const label = row.table_label?.trim()
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (best) return best[0]
  return toFields(members[0].fields)
    .slice(0, 3)
    .map((field) => field.key)
    .join(", ")
}

const defaultName = (rows: CandidateRow[]) => `${groupName(rows)} (combined)`

const tableNameOf = (row: CandidateRow) =>
  `${row.original_filename} · ${row.table_label ?? "table 1"}`

function toFields(fields: SchemaFieldJson[]): SchemaField[] {
  return (fields ?? []).map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    origin: field.origin,
    ...(field.currency ? { currency: field.currency } : {}),
  }))
}

function refusal(message: string, nextStep: string): MergeResult {
  return { ok: false, failure: { class: "merge_incompatible", message, nextStep }, conflicts: [] }
}
