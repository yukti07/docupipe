import type { FieldType, SchemaField } from "@/lib/api/types"

/**
 * Exactly two edits exist: change a field's type, and add a field.
 *
 * There is deliberately no renameField and no removeField in this module. The
 * schema describes what is in the document, so renaming it would make the table
 * disagree with its own source — and a function that exists gets called.
 */

/** Order-independent over (key, type). FNV-1a, which is enough to compare shapes. */
export function shapeHash(fields: Pick<SchemaField, "key" | "type">[]): string {
  const canonical = fields
    .map((f) => `${f.key}:${f.type}`)
    .sort()
    .join("|")

  let hash = 2166136261
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

export const sameShape = (
  a: Pick<SchemaField, "key" | "type">[],
  b: Pick<SchemaField, "key" | "type">[],
) => shapeHash(a) === shapeHash(b)

/** One editable schema, held per (fileId, schemaId). */
export type SchemaState = {
  fileId: string
  fileName: string
  filePath: string
  schemaId: string
  tableLabel: string
  version: number
  /** What the document said. Apply-to-all matches on this, never on `current`. */
  original: SchemaField[]
  current: SchemaField[]
}

export const isEdited = (schema: SchemaState) =>
  shapeHash(schema.original) !== shapeHash(schema.current)

/**
 * The files whose ORIGINAL shape matched this one's ORIGINAL shape.
 *
 * Matching on the current shape would make the result depend on what you had
 * already edited, so applying the same edit in a different order would hit a
 * different set of files.
 */
export function applyToAllTargets(all: SchemaState[], source: SchemaState): SchemaState[] {
  const hash = shapeHash(source.original)
  return all.filter(
    (schema) => schema.schemaId !== source.schemaId && shapeHash(schema.original) === hash,
  )
}

/** The one edit that is not a type change. */
export function validateNewField(
  name: string,
  fields: SchemaField[],
): { ok: true; key: string } | { ok: false; reason: string } {
  const trimmed = name.trim()
  if (trimmed.length === 0) return { ok: false, reason: "Give the field a name." }

  const key = fieldKey(trimmed)
  if (key.length === 0) {
    return { ok: false, reason: "Use letters or numbers in the name." }
  }
  if (fields.some((f) => f.key === key)) {
    return { ok: false, reason: `This schema already has a field called ${key}.` }
  }
  return { ok: true, key }
}

export const fieldKey = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

/** Edit one: change a field's type. */
export function changeFieldType(
  fields: SchemaField[],
  key: string,
  type: FieldType,
): SchemaField[] {
  return fields.map((field) => (field.key === key ? { ...field, type } : field))
}

/** Edit two: add a field. Added fields are marked, because they did not come from the document. */
export function addField(fields: SchemaField[], name: string, type: FieldType): SchemaField[] {
  const check = validateNewField(name, fields)
  if (!check.ok) throw new Error(check.reason)
  return [...fields, { key: check.key, label: name.trim(), type, origin: "added" }]
}

/** Schemas grouped by identical original shape, biggest group first. */
export function groupByOriginalShape(
  schemas: SchemaState[],
): { shapeHash: string; schemas: SchemaState[] }[] {
  const groups = new Map<string, SchemaState[]>()
  for (const schema of schemas) {
    const hash = shapeHash(schema.original)
    groups.set(hash, [...(groups.get(hash) ?? []), schema])
  }
  return [...groups.entries()]
    .map(([hash, members]) => ({ shapeHash: hash, schemas: members }))
    .sort((a, b) => b.schemas.length - a.schemas.length)
}
