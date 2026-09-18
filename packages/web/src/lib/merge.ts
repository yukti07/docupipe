import type { FieldType, MergeConflictDetail, SchemaField } from "@/lib/api/types"

/**
 * The shape rules for combining tables, in one place because the server
 * enforces them and the screen has to explain them, and those two must never
 * be able to disagree. A refusal the user could not have predicted from what
 * was on screen is a bug in this file.
 */

/**
 * A table's shape as a single comparable string: field keys with their types,
 * sorted, so the same fields in a different order are the same shape.
 *
 * Deliberately readable rather than hashed — it goes in a response, and a
 * grouping key you can read is worth more in a log than four bytes saved.
 */
export function shapeKey(fields: SchemaField[]): string {
  return [...fields]
    .map((field) => `${field.key}:${field.type}`)
    .sort()
    .join("|")
}

/** A short, stable id for a shape, for React keys and for `shapeHash` on the wire. */
export function shapeHash(fields: SchemaField[]): string {
  const text = shapeKey(fields)
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

export type ShapedTable = { schemaId: string; tableName: string; fields: SchemaField[] }

/**
 * Same names, same types, order-independent. No widening, no subsetting, no
 * coercion — a field one table lacks is as much a conflict as a field two
 * tables disagree about.
 */
export function mergeConflicts(tables: ShapedTable[]): MergeConflictDetail[] {
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

/** Ids the server mints for a merge, recognised wherever a schema id is taken. */
export const MERGE_ID_PREFIX = "mrg_"

export const isMergeId = (id: string): boolean => id.startsWith(MERGE_ID_PREFIX)
