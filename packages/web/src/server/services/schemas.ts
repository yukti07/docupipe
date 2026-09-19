import "server-only"

import type {
  SchemaEntry,
  SchemaPollResponse,
  SchemaSaveEntry,
  TableSchema,
  UpdateSchemaResponse,
} from "@/lib/api/types"
import { FIELD_TYPES } from "@/lib/api/types"
import { transaction } from "../db/client"
import * as repo from "../db/repos"
import { fail } from "../handler"

/**
 * §0.4 — the schema poll, and §0.5 — saving an edit.
 */

/**
 * `received` is the set of fileIds the client already holds, and only files
 * NOT in it come back.
 *
 * That makes the delta safe only because the inspect worker writes ALL of a
 * file's schemas in one transaction: a half-written file would be marked
 * received and its later tables would be permanently filtered out.
 */
export async function pollSchemas(
  userId: string,
  requestId: string,
  received: string[],
): Promise<SchemaPollResponse> {
  const request = await repo.getRequest(requestId, userId)
  if (!request) throw fail("internal", "We don't have a record of that request.")

  const [files, schemas, counts] = await Promise.all([
    repo.listFiles(requestId),
    repo.listSchemas(requestId),
    repo.shapeCounts(requestId),
  ])

  const seen = new Set(received.map(String))
  const byFile = new Map<string, repo.SchemaRow[]>()
  for (const schema of schemas) {
    const list = byFile.get(schema.file_id) ?? []
    list.push(schema)
    byFile.set(schema.file_id, list)
  }

  const entries: SchemaEntry[] = []
  let pending = 0

  for (const file of files) {
    // "Settled" means SCHEMA_READY **or** FAILED. Anything else is still
    // working, and it is what the Convert gate waits on.
    const settled = file.stage === "SCHEMA_READY" || file.stage === "FAILED"
    if (!settled) {
      pending += 1
      continue
    }
    if (seen.has(file.id)) continue

    if (file.stage === "FAILED") {
      entries.push({
        fileId: file.id,
        fileName: file.original_filename,
        filePath: file.object_key ?? "",
        schemaId: null,
        status: "failed",
        schema: null,
        failure: {
          class: file.failure_class ?? "internal",
          message: file.failure_detail ?? undefined,
        },
      })
      continue
    }

    const found = byFile.get(file.id) ?? []

    if (found.length === 0) {
      // Reached SCHEMA_READY with no tables: the file was readable, there was
      // just nothing table-shaped in it. That is a settled state, not a wait.
      entries.push({
        fileId: file.id,
        fileName: file.original_filename,
        filePath: file.object_key ?? "",
        schemaId: null,
        status: "failed",
        schema: null,
        failure: { class: "schema_not_found" },
      })
      continue
    }

    // A multi-table file appears ONCE PER TABLE — same fileId, different
    // schemaId. That is how a three-sheet spreadsheet becomes three editable
    // shapes.
    for (const schema of found) {
      // A table can fail on its own while the file around it is fine: an empty
      // worksheet in an otherwise readable workbook is exactly that. It is
      // still addressable, so the screen can name the worksheet that failed
      // rather than the file.
      if (schema.failure_class) {
        entries.push({
          fileId: file.id,
          fileName: file.original_filename,
          filePath: file.object_key ?? "",
          schemaId: schema.id,
          status: "failed",
          schema: null,
          tableLabel: schema.table_label ?? `table ${schema.table_ord + 1}`,
          failure: {
            class: schema.failure_class,
            message: schema.failure_detail ?? undefined,
          },
        })
        continue
      }

      entries.push({
        fileId: file.id,
        fileName: file.original_filename,
        filePath: file.object_key ?? "",
        schemaId: schema.id,
        status: "ready",
        schema: toTableSchema(schema, counts.get(schema.shape_hash) ?? 1),
      })
    }
  }

  // The gate is arrival, not inspection. A file whose shape is still being read
  // does not hold Convert shut: pressing it queues what is ready and the worker
  // carries the rest on as their shapes land.
  const arriving = files.filter((file) => file.stage === "UPLOADING").length
  const convertAvailable =
    arriving === 0 && files.length > 0 && request.converted_at === null

  return {
    userId,
    requestId,
    pending,
    convertAvailable,
    convertBlockedReason: blockedReason(arriving, files.length, request.converted_at !== null),
    files: entries,
  }
}

function blockedReason(arriving: number, total: number, converted: boolean): string | null {
  if (converted) return "This batch has already been converted."
  if (total === 0) return "No files have been uploaded yet."
  if (arriving > 0) {
    return arriving === 1
      ? "1 file is still uploading."
      : `${arriving} files are still uploading.`
  }
  return null
}

function toTableSchema(row: repo.SchemaRow, matchingFileCount: number): TableSchema {
  return {
    tableOrd: row.table_ord,
    tableLabel: row.table_label ?? `table ${row.table_ord + 1}`,
    version: row.version,
    // Over the ORIGINAL fields, so apply-to-all reaches "the files that
    // started out looking like this one" rather than a set that depends on the
    // order edits were made in.
    shapeHash: row.shape_hash,
    matchingFileCount,
    fields: row.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      origin: f.origin,
    })),
  }
}

/**
 * §0.5 — save an edit, and its apply-to-all scope.
 *
 * The scope simply IS the list of entries: the client resolves it from the
 * original shapes it already holds, so the server never reconstructs what the
 * user meant. It does still validate every one.
 */
export async function updateSchemas(
  userId: string,
  requestId: string,
  entries: SchemaSaveEntry[],
): Promise<UpdateSchemaResponse> {
  if (entries.length === 0) throw fail("internal", "Nothing to save.")

  const updated = await transaction(async (tx) => {
    const request = await repo.getRequest(requestId, userId)
    if (!request) throw fail("internal", "We don't have a record of that request.")

    // Schemas freeze at the gate. Rows are written against an approved shape,
    // and letting it move underneath produces a table where half the rows were
    // made under one set of rules.
    if (request.converted_at !== null) {
      throw fail(
        "gate_not_met",
        "This batch has already been converted, so its shapes are locked.",
      )
    }

    const out: { schemaId: string; version: number }[] = []
    let reference: string | null = null

    for (const entry of entries) {
      const schemaId = String(entry?.schemaId ?? "")
      const schema = await repo.getSchemaForUser(tx, schemaId, userId)
      if (!schema || schema.request_id !== requestId) {
        throw fail("internal", "One of those tables isn't in this batch.")
      }

      // Every entry must share the edited schema's ORIGINAL shape. If one does
      // not, the whole call is rejected — never a partial apply.
      reference ??= schema.shape_hash
      if (schema.shape_hash !== reference) {
        throw fail(
          "internal",
          "Those tables didn't start with the same shape, so they can't be saved together.",
        )
      }

      const fields = validateEdit(schema.original_fields, entry?.schema?.fields ?? [])
      const version = await repo.updateSchemaFields(tx, schemaId, fields)
      out.push({ schemaId, version })

      await repo.recordEvent(tx, {
        requestId,
        userId,
        fileId: schema.file_id,
        type: "SCHEMA_UPDATED",
        metadata: { schemaId, version, fields: fields.length },
      })
    }

    return out
  })

  return { status: "ok", updated }
}

/**
 * Exactly two edits exist: change a field's TYPE, and ADD a field.
 *
 * Enforced here against `original_fields` rather than trusted of the UI. An
 * inferred schema is a claim about the document — renaming a field makes the
 * table disagree with the file it came from, which is the seam where
 * provenance stops being checkable, and deleting one throws away something the
 * document genuinely contains.
 */
function validateEdit(
  original: repo.SchemaFieldJson[],
  incoming: { key: string; label: string; type: string; origin?: string }[],
): repo.SchemaFieldJson[] {
  if (!Array.isArray(incoming) || incoming.length === 0) {
    throw fail("internal", "A table needs at least one field.")
  }

  const originalByKey = new Map(original.map((f) => [f.key, f]))
  const seen = new Set<string>()
  const result: repo.SchemaFieldJson[] = []

  for (const field of incoming) {
    const key = String(field?.key ?? "").trim()
    if (!key) throw fail("internal", "A field needs a name.")
    if (seen.has(key)) throw fail("internal", `There are two fields called “${key}”.`)
    seen.add(key)

    const type = String(field?.type ?? "")
    if (!(FIELD_TYPES as readonly string[]).includes(type)) {
      throw fail("internal", `“${type}” isn't a field type.`)
    }

    const from = originalByKey.get(key)
    result.push({
      key,
      label: String(field?.label ?? key),
      type: type as repo.SchemaFieldJson["type"],
      // A field the document had keeps `detected` however it was edited; only
      // a genuinely new one is `added`, which is what the UI marks.
      origin: from ? "detected" : "added",
    })
  }

  // Deletion: every original field must still be present.
  for (const field of original) {
    if (!seen.has(field.key)) {
      throw fail(
        "internal",
        `“${field.key}” is in the document, so it can't be removed from the table.`,
      )
    }
  }

  return result
}
