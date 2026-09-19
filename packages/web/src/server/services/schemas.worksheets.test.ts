import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A workbook reaches the schema screen as one entry per worksheet. A worksheet
 * that yielded nothing is one of those entries and says so — it is not missing,
 * and it does not fail the sheets beside it.
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

const FIELDS = [{ key: "id", label: "id", type: "text", origin: "detected" }]

const schema = (
  id: string,
  table_ord: number,
  table_label: string,
  failure: { failure_class?: string; failure_detail?: string } = {},
) => ({
  id,
  file_id: "F100",
  request_id: "R123",
  table_ord,
  table_label,
  version: 1,
  fields: FIELDS,
  original_fields: FIELDS,
  shape_hash: `hash_${table_ord}`,
  failure_class: null,
  failure_detail: null,
  ...failure,
})

beforeEach(() => {
  getRequest.mockReset().mockResolvedValue({ id: "R123", converted_at: null })
  shapeCounts.mockReset().mockResolvedValue(new Map())
  listFiles.mockReset().mockResolvedValue([
    {
      id: "F100",
      request_id: "R123",
      user_id: "U1",
      original_filename: "bank_statement.xlsx",
      content_type: null,
      bucket: "b",
      object_key: "requests/R123/input/F100/bank_statement.xlsx",
      stage: "SCHEMA_READY",
      failure_class: null,
      failure_detail: null,
    },
  ])
  listSchemas.mockReset()
})

describe("the schema poll over a workbook", () => {
  it("returns one entry per worksheet, all under the one file", async () => {
    listSchemas.mockResolvedValue([
      schema("sch_0", 0, "Transactions"),
      schema("sch_1", 1, "Account Summary"),
      schema("sch_2", 2, "Metadata"),
    ])

    const poll = await pollSchemas("U1", "R123", [])

    expect(poll.files.map((entry) => entry.schemaId)).toEqual(["sch_0", "sch_1", "sch_2"])
    expect(new Set(poll.files.map((entry) => entry.fileId))).toEqual(new Set(["F100"]))
    expect(poll.files.map((entry) => entry.schema?.tableLabel)).toEqual([
      "Transactions",
      "Account Summary",
      "Metadata",
    ])
  })

  it("marks the one worksheet that yielded nothing, and only that one", async () => {
    listSchemas.mockResolvedValue([
      schema("sch_0", 0, "Transactions"),
      schema("sch_1", 1, "Blank", {
        failure_class: "extract_empty",
        failure_detail: "The sheet 'Blank' has no columns.",
      }),
      schema("sch_2", 2, "Metadata"),
    ])

    const poll = await pollSchemas("U1", "R123", [])

    expect(poll.files.map((entry) => entry.status)).toEqual(["ready", "failed", "ready"])
    expect(poll.files[1].failure?.class).toBe("extract_empty")
    // Still addressable, so the screen can name the worksheet that failed.
    expect(poll.files[1].schemaId).toBe("sch_1")
  })

  it("does not hold Convert shut because one worksheet failed", async () => {
    listSchemas.mockResolvedValue([
      schema("sch_0", 0, "Transactions"),
      schema("sch_1", 1, "Blank", { failure_class: "extract_empty" }),
    ])

    const poll = await pollSchemas("U1", "R123", [])

    expect(poll.convertAvailable).toBe(true)
    expect(poll.pending).toBe(0)
  })
})
