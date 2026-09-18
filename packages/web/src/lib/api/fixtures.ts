import evidenceFixture from "@fixtures/api/evidence.json"
import mergeGroupsFixture from "@fixtures/api/merge-groups.json"
import rawTextFixture from "@fixtures/api/raw-text.json"
import tableFixture from "@fixtures/api/table-invoice-1044.json"
import { mergeConflicts, type ShapedTable } from "@/lib/merge"
import type { QuarryApi } from "./contract"
import type {
  Evidence,
  FieldType,
  MergeConflictDetail,
  MergeGroup,
  MergedTable,
  MergeResult,
  RawText,
  SchemaField,
  TableData,
  TableRow,
} from "./types"

/** Enough delay that a loading state is exercised in development rather than skipped. */
const DELAY_MS = 120

function later<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), DELAY_MS))
}

const TABLE = tableFixture as unknown as TableData
const EVIDENCE = evidenceFixture as unknown as Record<string, Evidence>
const RAW_TEXT = rawTextFixture as unknown as RawText
const MERGE_GROUPS = mergeGroupsFixture as unknown as MergeGroup[]

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

/** Deterministic from the id, so a table looks the same on every visit. */
function seededInt(seed: string, index: number, mod: number): number {
  let hash = 2166136261
  const text = `${seed}:${index}`
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash) % mod
}

function syntheticRow(schemaId: string, fields: SchemaField[], index: number): TableRow {
  const values: TableRow["values"] = {}
  for (const field of fields) {
    const n = seededInt(`${schemaId}:${field.key}`, index, 9000)
    const display: Record<FieldType, string> = {
      text: `${field.key.replace(/_/g, " ")} ${n}`,
      number: String(n),
      currency: (n / 10 + 40).toFixed(2),
      date: `2026-0${(n % 9) + 1}-${String((n % 27) + 1).padStart(2, "0")}`,
      boolean: n % 2 === 0 ? "yes" : "no",
      list: [`${n % 90}`, `${(n + 7) % 90}`].join(", "),
    }
    values[field.key] = {
      valueId: `val_${schemaId}_${index}_${field.key}`,
      display: display[field.type],
      state: "value",
    }
  }
  return { recordId: `${schemaId}_rec_${index + 1}`, values }
}

/** The one hand-written table is invoice-1044; anything else is generated from its shape. */
function tableFor(requestId: string, schemaId: string): TableData {
  if (schemaId === TABLE.schemaId) return { ...TABLE, requestId }

  const merge = fixtureMerges.get(schemaId)
  if (merge) return mergedTableFor(requestId, merge)

  const group = MERGE_GROUPS.find((g) => g.members.some((m) => m.schemaId === schemaId))
  const member = group?.members.find((m) => m.schemaId === schemaId)
  const fields = group?.fields ?? TABLE.fields
  const rowCount = member?.rowCount ?? 12

  return {
    requestId,
    schemaId,
    fileId: member?.fileId ?? "file_unknown",
    fileName: member?.fileName ?? `${schemaId}.pdf`,
    tableLabel: member?.tableLabel ?? "table 1",
    pageRange: null,
    fields,
    rows: Array.from({ length: rowCount }, (_, i) => syntheticRow(schemaId, fields, i)),
  }
}

/** Every member's rows under one another, each carrying the table it came from. */
function mergedTableFor(
  requestId: string,
  merge: MergedTable & { schemaIds: string[] },
): TableData {
  const group = MERGE_GROUPS.find((g) => g.shapeHash === merge.shapeHash)
  const fields = group?.fields ?? TABLE.fields

  const rows = merge.schemaIds.flatMap((schemaId) => {
    const member = group?.members.find((m) => m.schemaId === schemaId)
    const source = member ? `${member.fileName} · ${member.tableLabel}` : schemaId
    return Array.from({ length: member?.rowCount ?? 0 }, (_, i) => ({
      ...syntheticRow(schemaId, fields, i),
      sourceFile: source,
    }))
  })

  return {
    requestId,
    schemaId: merge.mergeId,
    fileId: merge.mergeId,
    fileName: merge.name,
    tableLabel: merge.name,
    pageRange: null,
    merged: true,
    fields,
    rows,
  }
}

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

/**
 * Evidence opens from any cell, not only the ones we wrote by hand. A value we
 * have no locator for says so plainly rather than drawing a box we aren't sure
 * about — which is the honest behaviour the real endpoint will also have.
 */
function evidenceFor(valueId: string): Evidence {
  const known = EVIDENCE[valueId]
  if (known) return known

  const fieldKey = valueId.split("_").slice(-1)[0] ?? "value"
  return {
    valueId,
    fieldKey,
    rowIndex: 0,
    display: "",
    locator: {
      type: "none",
      sourceText:
        "This batch came from a fixture, so the original page is not stored alongside it.",
      reason: "There is no source document behind this fixture row to point at.",
    },
  }
}

/* ------------------------------------------------------------------ */
/* Merge — the exact check, run client-side until the endpoint lands   */
/* ------------------------------------------------------------------ */

function selectedTables(schemaIds: string[]): ShapedTable[] {
  const out: ShapedTable[] = []
  for (const group of MERGE_GROUPS) {
    for (const member of group.members) {
      if (!schemaIds.includes(member.schemaId)) continue
      out.push({
        schemaId: member.schemaId,
        tableName: `${member.fileName} · ${member.tableLabel}`,
        fields: group.fields,
      })
    }
  }
  return out
}

/* ------------------------------------------------------------------ */

/**
 * Merges made in this browser session. The fixtures have no server behind them,
 * so a merge has to be remembered somewhere for the results list to show it —
 * and the merge screen is only honest if pressing Save changes what comes back
 * from the next overview.
 */
const fixtureMerges = new Map<string, MergedTable & { schemaIds: string[] }>()

/** Groups minus whatever is already merged, which is what the picker may offer. */
function openGroups(): MergeGroup[] {
  const taken = new Set([...fixtureMerges.values()].flatMap((m) => m.schemaIds))
  return MERGE_GROUPS.map((group) => ({
    ...group,
    members: group.members.filter((m) => !taken.has(m.schemaId)),
  })).filter((group) => group.members.length > 0)
}

export const FixtureApi: Pick<
  QuarryApi,
  | "getTable"
  | "getEvidence"
  | "getRawText"
  | "getMergeOverview"
  | "createMerges"
  | "deleteMerge"
> = {
  getTable: (requestId, schemaId) => later(tableFor(requestId, schemaId)),

  getEvidence: (valueId) => later(evidenceFor(valueId)),

  getRawText: (_requestId, schemaId) =>
    later(schemaId === RAW_TEXT.schemaId ? RAW_TEXT : { ...RAW_TEXT, schemaId }),

  getMergeOverview: () =>
    later({
      groups: openGroups(),
      merges: [...fixtureMerges.values()],
      tableCount: openGroups().reduce((n, g) => n + g.members.length, 0) + fixtureMerges.size,
    }),

  createMerges: (_userId, _requestId, submissions) => {
    const conflicts: MergeConflictDetail[] = []
    for (const submission of submissions) {
      const tables = selectedTables(submission.schemaIds)
      const shapeHash = shapeHashOf(submission.schemaIds)
      conflicts.push(
        ...mergeConflicts(tables).map((conflict) => ({ ...conflict, shapeHash })),
      )
    }

    if (conflicts.length > 0) {
      return later<MergeResult>({ ok: false, failure: { class: "merge_incompatible" }, conflicts })
    }

    const merges = submissions.map((submission) => {
      const members = MERGE_GROUPS.flatMap((g) => g.members).filter((m) =>
        submission.schemaIds.includes(m.schemaId),
      )
      const merge: MergedTable & { schemaIds: string[] } = {
        mergeId: `mrg_${shapeHashOf(submission.schemaIds)}_${submission.schemaIds.length}`,
        name: submission.name,
        rowCount: members.reduce((sum, m) => sum + m.rowCount, 0),
        tableCount: members.length,
        shapeHash: shapeHashOf(submission.schemaIds),
        schemaIds: submission.schemaIds,
      }
      fixtureMerges.set(merge.mergeId, merge)
      return merge
    })

    const open = openGroups().reduce((n, g) => n + g.members.length, 0)
    return later<MergeResult>({ ok: true, merges, tableCount: open + fixtureMerges.size })
  },

  deleteMerge: (_userId, _requestId, mergeId) => {
    fixtureMerges.delete(mergeId)
    return later({ status: "ok" as const })
  },
}

/** The shape the first of these tables has — every member of a group shares it. */
function shapeHashOf(schemaIds: string[]): string {
  const group = MERGE_GROUPS.find((g) => g.members.some((m) => schemaIds.includes(m.schemaId)))
  return group?.shapeHash ?? "unknown"
}
