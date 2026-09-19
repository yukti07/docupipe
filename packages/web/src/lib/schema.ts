import type { Failure, FieldType, SchemaEntry, SchemaField } from "@/lib/api/types"

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
  /** What the document said, so an edited field can say what it used to be. */
  original: SchemaField[]
  current: SchemaField[]
}

/**
 * Someone has changed this schema — in this browser just now, or before it ever
 * loaded. The second half matters: `original` is only what the server held when
 * this screen first read it, so after a reload or a move to another screen an
 * edit made earlier looks like the shape the document came with. The version
 * counter is the server's own record and survives both.
 */
export const isEdited = (schema: SchemaState) =>
  schema.version > 1 || shapeHash(schema.original) !== shapeHash(schema.current)

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

/**
 * What has happened to a schema, which is what the review screen puts on every
 * card. Generated is the shape the document was read as, modified is one a
 * person has saved over it, unsaved is one being edited right now.
 *
 * The draft is not in `SchemaState` — it lives in whichever editor is open — so
 * that third state is passed in rather than derived.
 */
export type SchemaStatus = "generated" | "modified" | "unsaved"

export const schemaStatus = (schemas: SchemaState[], unsaved = false): SchemaStatus =>
  unsaved ? "unsaved" : schemas.some(isEdited) ? "modified" : "generated"

/** Tables that share one shape, held together so they can be edited as one. */
export type SchemaGroup = { shapeHash: string; schemas: SchemaState[] }

/**
 * Schemas grouped by the shape they have *now*.
 *
 * This is what the review screen groups on, and it is deliberately not the
 * original: a table whose type was already changed from its own file's row no
 * longer matches the ones it started beside, so it leaves that group and gets a
 * card of its own. The card then means what it says — every table with this
 * schema — rather than every table that once had it.
 */
export const groupByCurrentShape = (schemas: SchemaState[]): SchemaGroup[] =>
  groupBy(schemas, (schema) => shapeHash(schema.current))

function groupBy(schemas: SchemaState[], hashOf: (schema: SchemaState) => string): SchemaGroup[] {
  const groups = new Map<string, SchemaState[]>()
  for (const schema of schemas) {
    const hash = hashOf(schema)
    groups.set(hash, [...(groups.get(hash) ?? []), schema])
  }
  return [...groups.entries()]
    .map(([hash, members]) => ({ shapeHash: hash, schemas: members }))
    .sort((a, b) => b.schemas.length - a.schemas.length)
}

/**
 * One other table this schema can be written onto, and how far it is from it.
 *
 * `added` is the fields this write would bring that the table does not have —
 * they arrive empty. A table that holds a field this schema does not is never a
 * target at all: writing this shape over it would take that field away, and
 * removing a field is not one of the two edits this product has.
 */
export type UpdateTarget = {
  schema: SchemaState
  added: string[]
}

/**
 * The tables this one can be pushed onto: the ones carrying exactly its field
 * names, and the ones short of exactly one of them.
 *
 * Matching is on names alone. A type that disagrees is the whole reason the
 * push exists, so it cannot also be what rules a table out.
 */
export function updateTargetsFor(all: SchemaState[], source: SchemaState): UpdateTarget[] {
  const keys = source.current.map((f) => f.key)
  const wanted = new Set(keys)

  return all
    .filter((schema) => schema.schemaId !== source.schemaId)
    .flatMap<UpdateTarget>((schema) => {
      const theirs = new Set(schema.current.map((f) => f.key))
      if ([...theirs].some((key) => !wanted.has(key))) return []
      const added = keys.filter((key) => !theirs.has(key))
      return added.length > 1 ? [] : [{ schema, added }]
    })
    .sort(
      (a, b) =>
        a.added.length - b.added.length || a.schema.fileName.localeCompare(b.schema.fileName),
    )
}

/**
 * Whether every accepted file has settled a shape — one it gave up, or the
 * reason it has none. Both count: a file that could not be read has finished
 * being read just as surely as one that was.
 *
 * Counted over the files themselves rather than by summing the two lists, so a
 * file that gave up three tables still counts once.
 */
export function allShapesSettled(
  schemas: { fileId: string }[],
  wontConvert: { fileId: string }[],
  acceptedCount: number,
): boolean {
  if (acceptedCount === 0) return false
  const settled = new Set([
    ...schemas.map((s) => s.fileId),
    ...wontConvert.map((w) => w.fileId),
  ])
  return settled.size >= acceptedCount
}

/** A file that gave up no table at all. */
export type FileFailure = { fileId: string; fileName: string; failure: Failure }

/** One table of a file that gave up nothing, while its siblings did. */
export type TableFailure = FileFailure & { schemaId: string; tableLabel: string }

/**
 * Which failures are the file's and which are one table's.
 *
 * The distinction is the whole of what a workbook needs: an empty worksheet in
 * an otherwise readable workbook must not read as "this file won't convert",
 * because the file converts — two of its three sheets are on screen waiting to
 * be edited. The poll says which by whether the entry names a table.
 */
export function partitionFailures(entries: SchemaEntry[]): {
  files: FileFailure[]
  tables: TableFailure[]
} {
  const files: FileFailure[] = []
  const tables: TableFailure[] = []

  for (const entry of entries) {
    if (entry.status !== "failed") continue

    const failure = entry.failure ?? { class: "schema_inference_failed" as const }
    const common = { fileId: entry.fileId, fileName: entry.fileName, failure }

    if (entry.schemaId) {
      tables.push({
        ...common,
        schemaId: entry.schemaId,
        tableLabel: entry.tableLabel ?? entry.schema?.tableLabel ?? "",
      })
    } else {
      files.push(common)
    }
  }

  return { files, tables }
}
