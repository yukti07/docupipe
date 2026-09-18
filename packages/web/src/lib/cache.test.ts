import { describe, expect, it } from "vitest"
import type { ResultPollResponse, TableData } from "@/lib/api/types"
import {
  forgetCached,
  readCachedResult,
  readCachedTable,
  writeCachedResult,
  writeCachedTable,
} from "./cache"

const result = (over: Partial<ResultPollResponse> = {}): ResultPollResponse => ({
  userId: "usr_1",
  requestId: "req_1",
  status: "CONVERTING",
  pausedUntil: null,
  counts: { queued: 2, extracting: 0, filling: 0, done: 1, failed: 0 },
  rowsSoFar: 22,
  estimatedSecondsRemaining: null,
  allowance: { used: 0, limit: 5000, resetsAt: "2026-09-19T00:00:00Z" },
  files: [],
  ...over,
})

/** A table of roughly `chars` bytes, for filling the budget up. */
const table = (fileName: string, chars = 0): TableData => ({
  requestId: "req_1",
  schemaId: "sch_1",
  fileId: "f1",
  fileName,
  tableLabel: "table 1",
  pageRange: null,
  fields: [{ key: "a", label: "a", type: "text", origin: "detected" }],
  rows: chars
    ? [{ recordId: "r1", values: { a: { valueId: "v1", display: "x".repeat(chars), state: "value" } } }]
    : [],
})

describe("the answer cache", () => {
  it("gives back what it was handed", () => {
    writeCachedResult("req_1", result({ rowsSoFar: 41 }))
    expect(readCachedResult("req_1")?.rowsSoFar).toBe(41)

    writeCachedTable("req_1", "sch_1", table("invoice-1043.pdf"))
    expect(readCachedTable("req_1", "sch_1")?.fileName).toBe("invoice-1043.pdf")
  })

  it("misses rather than throws when there is nothing there", () => {
    expect(readCachedResult("req_nope")).toBeNull()
    expect(readCachedTable("req_nope", "sch_nope")).toBeNull()
  })

  it("refuses an entry too big to be worth the room it would take", () => {
    writeCachedTable("req_1", "sch_big", table("huge.pdf", 1_200_000))
    expect(readCachedTable("req_1", "sch_big")).toBeNull()
  })

  it("drops the oldest rather than growing without limit", () => {
    // Three quarters of the budget each: the third forces the first two out.
    const big = 750_000
    writeCachedTable("req_1", "sch_a", table("a.pdf", big))
    writeCachedTable("req_1", "sch_b", table("b.pdf", big))
    writeCachedTable("req_1", "sch_c", table("c.pdf", big))

    expect(readCachedTable("req_1", "sch_a")).toBeNull()
    expect(readCachedTable("req_1", "sch_c")?.fileName).toBe("c.pdf")
    // And the store is left holding only what fits, not every table ever opened.
    expect(Object.keys(localStorage).filter((k) => k.includes(".table.")).length).toBeLessThan(3)
  })

  it("forgets everything a discarded batch left behind", () => {
    writeCachedResult("req_1", result())
    writeCachedTable("req_1", "sch_1", table("a.pdf"))
    writeCachedResult("req_2", result({ requestId: "req_2" }))

    forgetCached("req_1")

    expect(readCachedResult("req_1")).toBeNull()
    expect(readCachedTable("req_1", "sch_1")).toBeNull()
    // Another batch's answers are not collateral.
    expect(readCachedResult("req_2")).not.toBeNull()
  })

  it("refuses an entry an older build shaped differently, and clears it out", () => {
    // `counts` lost a stage. Handing this back would throw in the pipeline strip
    // on every load, and keeping it would make that permanent.
    localStorage.setItem(
      "quarry.cache.req_1.result",
      JSON.stringify({ ...result(), counts: { queued: 2, done: 1 } }),
    )

    expect(readCachedResult("req_1")).toBeNull()
    expect(localStorage.getItem("quarry.cache.req_1.result")).toBeNull()
  })

  it("refuses a table with no rows array rather than letting the screen map over undefined", () => {
    localStorage.setItem("quarry.cache.req_1.table.sch_1", JSON.stringify({ fileName: "a.pdf" }))
    expect(readCachedTable("req_1", "sch_1")).toBeNull()
  })

  it("survives a store that is not there at all", () => {
    localStorage.setItem("quarry.cache.req_1.result", "{ not json")
    expect(readCachedResult("req_1")).toBeNull()
  })
})
