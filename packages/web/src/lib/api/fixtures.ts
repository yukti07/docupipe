import evidenceFixture from "@fixtures/api/evidence.json"
import mergeGroupsFixture from "@fixtures/api/merge-groups.json"
import rawTextFixture from "@fixtures/api/raw-text.json"
import tableFixture from "@fixtures/api/table-invoice-1044.json"
import type { QuarryApi } from "./contract"
import type {
  Evidence,
  FieldType,
  MergeConflictDetail,
  MergeGroup,
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

type Selected = { schemaId: string; tableName: string; fields: SchemaField[] }

function selectedTables(schemaIds: string[]): Selected[] {
  const out: Selected[] = []
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

/**
 * Same names, same types, order-independent. No widening, no subsetting, no
 * coercion — a field one table lacks is as much a conflict as a field two
 * tables disagree about.
 */
export function mergeConflicts(tables: Selected[]): MergeConflictDetail[] {
  const names = new Set<string>()
  for (const table of tables) for (const field of table.fields) names.add(field.key)

  const conflicts: MergeConflictDetail[] = []
  for (const name of names) {
    const byType = new Map<FieldType, string[]>()
    let present = 0
    for (const table of tables) {
      const field = table.fields.find((f) => f.key === name)
      if (!field) continue
      present += 1
      byType.set(field.type, [...(byType.get(field.type) ?? []), table.tableName])
    }
    const disagrees = byType.size > 1
    const missing = present !== tables.length
    if (!disagrees && !missing) continue
    conflicts.push({
      field: name,
      groups: [...byType.entries()].map(([type, tableNames]) => ({ type, tableNames })),
    })
  }

  // A type disagreement is the more specific complaint, so it is named first.
  return conflicts.sort((a, b) => b.groups.length - a.groups.length)
}

/* ------------------------------------------------------------------ */

export const FixtureApi: Pick<
  QuarryApi,
  "getTable" | "getEvidence" | "getRawText" | "getMergeGroups" | "createMerge"
> = {
  getTable: (requestId, schemaId) => later(tableFor(requestId, schemaId)),

  getEvidence: (valueId) => later(evidenceFor(valueId)),

  getRawText: (_requestId, schemaId) =>
    later(schemaId === RAW_TEXT.schemaId ? RAW_TEXT : { ...RAW_TEXT, schemaId }),

  getMergeGroups: () => later(MERGE_GROUPS),

  createMerge: (_requestId, schemaIds, name) => {
    const tables = selectedTables(schemaIds)
    const conflicts = mergeConflicts(tables)

    if (conflicts.length > 0) {
      return later<MergeResult>({
        ok: false,
        failure: { class: "merge_incompatible" },
        conflicts,
      })
    }

    const rowCount = MERGE_GROUPS.flatMap((g) => g.members)
      .filter((m) => schemaIds.includes(m.schemaId))
      .reduce((sum, m) => sum + m.rowCount, 0)

    return later<MergeResult>({
      ok: true,
      mergeId: `mrg_${schemaIds.length}_${rowCount}`,
      name,
      rowCount,
      tableCount: tables.length,
    })
  },
}
