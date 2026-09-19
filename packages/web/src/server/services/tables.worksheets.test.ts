import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A workbook is one file with one record table, and one processing run per
 * worksheet inside it. Which rows belong to which worksheet is therefore a
 * question about the RUN, and the run is found through the schema — not
 * through the file, which has several.
 */

const queryOne = vi.fn()
const query = vi.fn()

vi.mock("../db/client", () => ({
  queryOne: (...args: unknown[]) => queryOne(...args),
  query: (...args: unknown[]) => query(...args),
}))

const { getTable } = await import("./tables")

const FIELDS = [
  { key: "order_id", label: "order_id", type: "number", origin: "detected" },
  { key: "amount", label: "amount", type: "number", origin: "detected" },
]

type Call = { sql: string; params: unknown[] }
let calls: Call[]

const HASH = "a".repeat(24)
let TARGET: { record_table: string | null; legacy_record_table: string | null }

/** The three worksheet rows of one workbook, and the run that filled each. */
const RUNS: Record<string, string> = {
  sch_transactions: "run_transactions",
  sch_summary: "run_summary",
  sch_metadata: "run_metadata",
}

const ROWS: Record<string, Record<string, unknown>> = {
  run_transactions: { order_id: 1, amount: 10 },
  run_summary: { order_id: 2, amount: 20 },
  run_metadata: { order_id: 3, amount: 30 },
}

beforeEach(() => {
  calls = []
  TARGET = { record_table: `structured_records_${HASH}_t1`, legacy_record_table: null }
  queryOne.mockReset()
  query.mockReset()

  queryOne.mockImplementation(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params })
    if (sql.includes("FROM file_schemas")) {
      return {
        file_id: "F100",
        original_filename: "bank_statement.xlsx",
        table_label: "Orders",
        fields: FIELDS,
        record_table: TARGET.record_table,
        legacy_record_table: TARGET.legacy_record_table,
      }
    }
    if (sql.includes("processing_runs")) {
      const schemaId = params[0] as string
      return RUNS[schemaId] ? { id: RUNS[schemaId] } : null
    }
    return null
  })

  query.mockImplementation(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params })
    if (sql.includes("record_errors")) return []
    const runId = params[0] as string
    return [{ id: `rec-1`, record_number: 1, status: "VALID", data: ROWS[runId] }]
  })
})

describe("a worksheet's table", () => {
  it("opens, rather than refusing because the file holds more than one", async () => {
    const table = await getTable("U1", "R123", "sch_summary")

    expect(table.rows).toHaveLength(1)
    expect(table.tableLabel).toBe("Orders")
  })

  it("reads the run that filled this worksheet, not the file's newest run", async () => {
    const table = await getTable("U1", "R123", "sch_metadata")

    const runQuery = calls.find((call) => call.sql.includes("processing_runs"))
    // Addressed by the schema. Addressing it by file_id is what made a
    // three-sheet workbook show one sheet's rows under all three names.
    expect(runQuery?.params[0]).toBe("sch_metadata")
    expect(table.rows[0].values.order_id.display).toBe("3")
  })

  it("keeps two worksheets of one workbook apart", async () => {
    const first = await getTable("U1", "R123", "sch_transactions")
    const second = await getTable("U1", "R123", "sch_summary")

    expect(first.rows[0].values.amount.display).toBe("10")
    expect(second.rows[0].values.amount.display).toBe("20")
  })

  it("says so plainly when this worksheet has not been converted yet", async () => {
    await expect(getTable("U1", "R123", "sch_unconverted")).rejects.toMatchObject({
      failureClass: "processing_failed",
    })
  })
})

describe("where a worksheet's rows are stored", () => {
  it("reads the table belonging to this worksheet, not one shared with its siblings", async () => {
    await getTable("U1", "R123", "sch_summary")

    const rows = calls.find((c) => c.sql.includes("record_number, status, data"))
    expect(rows?.sql).toContain(`structured_records_${HASH}_t1`)
  })

  it("derives that name from the file AND the table's ordinal", async () => {
    await getTable("U1", "R123", "sch_summary")

    const target = calls.find((c) => c.sql.includes("FROM file_schemas"))
    // The ordinal has to come from the schema row, or every worksheet of a
    // file resolves to the same physical table again.
    expect(target?.sql).toContain("s.table_ord")
  })

  it("still opens a table converted before the rows were split per worksheet", async () => {
    TARGET = { record_table: null, legacy_record_table: `structured_records_${HASH}` }

    const table = await getTable("U1", "R123", "sch_summary")

    const rows = calls.find((c) => c.sql.includes("record_number, status, data"))
    expect(rows?.sql).toContain(`structured_records_${HASH}`)
    expect(table.rows).toHaveLength(1)
  })

  it("says no rows were written when neither name exists", async () => {
    TARGET = { record_table: null, legacy_record_table: null }

    await expect(getTable("U1", "R123", "sch_summary")).rejects.toMatchObject({
      failureClass: "processing_failed",
    })
  })
})
