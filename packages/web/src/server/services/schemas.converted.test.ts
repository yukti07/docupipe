import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Review schemas stays reachable after Convert — read-only, as the record of
 * what the batch was read against. The poll behind it therefore has to answer
 * for a file whose conversion has already started or finished.
 *
 * It used to answer only for SCHEMA_READY and FAILED, so every file of a
 * converted batch was counted as still being read and none of them came back.
 * The screen settled on "No schema came back" for a batch whose tables were on
 * screen one step away.
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

const FIELDS = [{ key: "total", label: "total", type: "currency", origin: "detected" }]

const file = (stage: string) => ({
  id: "F100",
  request_id: "R123",
  user_id: "U1",
  original_filename: "invoices.csv",
  content_type: null,
  bucket: "b",
  object_key: "requests/R123/input/F100/invoices.csv",
  stage,
  failure_class: null,
  failure_detail: null,
})

beforeEach(() => {
  getRequest.mockReset().mockResolvedValue({ id: "R123", converted_at: "2026-09-20T10:00:00Z" })
  shapeCounts.mockReset().mockResolvedValue(new Map())
  listSchemas.mockReset().mockResolvedValue([
    {
      id: "sch_0",
      file_id: "F100",
      request_id: "R123",
      table_ord: 0,
      table_label: "invoices",
      version: 2,
      fields: FIELDS,
      original_fields: FIELDS,
      shape_hash: "hash_0",
      failure_class: null,
      failure_detail: null,
    },
  ])
  listFiles.mockReset()
})

describe("the schema poll after the gate", () => {
  it.each(["CONVERTING", "COMPLETED"])("still answers for a %s file", async (stage) => {
    listFiles.mockResolvedValue([file(stage)])

    const poll = await pollSchemas("U1", "R123", [])

    expect(poll.files.map((entry) => entry.schemaId)).toEqual(["sch_0"])
    expect(poll.files[0].status).toBe("ready")
    // Nothing is outstanding: a file being converted is a file whose shape was
    // read long ago, and counting it as pending is what hid it.
    expect(poll.pending).toBe(0)
  })

  it("counts a file whose shape is genuinely still being read", async () => {
    listFiles.mockResolvedValue([file("INSPECTING")])

    const poll = await pollSchemas("U1", "R123", [])

    expect(poll.files).toEqual([])
    expect(poll.pending).toBe(1)
  })

  it("does not offer Convert twice", async () => {
    listFiles.mockResolvedValue([file("COMPLETED")])

    const poll = await pollSchemas("U1", "R123", [])

    expect(poll.convertAvailable).toBe(false)
    expect(poll.convertBlockedReason).toBe("This batch has already been converted.")
  })
})
