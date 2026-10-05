import { describe, expect, it, vi } from "vitest"
import { partitionFailures, settledFileIds } from "@/lib/schema"
import type { SchemaEntry } from "@/lib/api/types"

/**
 * The frontend stops polling for shapes when every file that landed has
 * settled. That is only safe because of an invariant the worker holds and the
 * frontend cannot see: a file reaches SCHEMA_READY only if at least one of its
 * tables produced a shape, and a file where none did is failed as a FILE —
 * `schema_pipeline._detect`, `if not versions: raise DomainError(...)`.
 *
 * If that ever changes, the poll would run its whole budget and the screen
 * would read "Detecting" for the rest of the run. This fails first instead.
 */

const getRequest = vi.fn()
const listFiles = vi.fn()
const listSchemas = vi.fn()
const shapeCounts = vi.fn()

vi.mock("../db/repos", () => ({
  getRequest: (...a: unknown[]) => getRequest(...a),
  listFiles: (...a: unknown[]) => listFiles(...a),
  listSchemas: (...a: unknown[]) => listSchemas(...a),
  shapeCounts: (...a: unknown[]) => shapeCounts(...a),
}))

const { pollSchemas } = await import("./schemas")

const ready = (ord: number) => ({
  id: `sch_${ord}`,
  file_id: "f_1",
  table_ord: ord,
  table_label: `Sheet ${ord + 1}`,
  version: 1,
  shape_hash: "h",
  failure_class: null,
  failure_detail: null,
  fields: [{ key: "a", label: "a", type: "text" }],
})

const failedTable = (ord: number) => ({
  ...ready(ord),
  failure_class: "schema_not_found",
  fields: [],
})

const setup = (stage: string, schemas: unknown[]) => {
  getRequest.mockResolvedValue({ id: "R1", converted_at: null })
  listFiles.mockResolvedValue([
    { id: "f_1", original_filename: "books.xlsx", stage, object_key: "k" },
  ])
  listSchemas.mockResolvedValue(schemas)
  shapeCounts.mockResolvedValue(new Map([["h", 1]]))
}

/** The poll's own stop condition, read off a response. */
const settles = (entries: SchemaEntry[]) => {
  const { files, tables } = partitionFailures(entries)
  const shapes = entries.filter((e) => e.status === "ready")
  return settledFileIds(shapes, files, tables).has("f_1")
}

describe("a file always settles, whatever its tables did", () => {
  it("settles a workbook with one empty sheet and two readable ones", async () => {
    setup("SCHEMA_READY", [ready(0), failedTable(1), ready(2)])
    const { files } = await pollSchemas("u1", "R1", [])

    expect(partitionFailures(files).tables).toHaveLength(1)
    expect(settles(files)).toBe(true)
  })

  it("settles a workbook where every sheet was empty, as a FILE-level failure", async () => {
    // The stage is the invariant: the worker failed the file, so the poll
    // short-circuits before it reads a single schema row.
    setup("FAILED", [failedTable(0), failedTable(1)])
    const { files } = await pollSchemas("u1", "R1", [])

    expect(files).toHaveLength(1)
    expect(files[0].schemaId).toBeNull()
    expect(partitionFailures(files).tables).toEqual([])
    expect(settles(files)).toBe(true)
  })

  it("settles even if a file ever reaches SCHEMA_READY with every table failed", async () => {
    // Not producible by the current worker. `settledFileIds` counts
    // `emptyTables` so that if it ever becomes producible, the poll stops.
    setup("SCHEMA_READY", [failedTable(0), failedTable(1)])
    const { files } = await pollSchemas("u1", "R1", [])

    expect(partitionFailures(files).tables).toHaveLength(2)
    expect(partitionFailures(files).files).toEqual([])
    expect(settles(files)).toBe(true)
  })
})
