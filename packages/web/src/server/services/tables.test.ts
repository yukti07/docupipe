import { describe, expect, it } from "vitest"
import type { SchemaFieldJson } from "../db/repos"
import { toTableData, type RecordErrorRow, type RecordRow } from "./tables"

const fields: SchemaFieldJson[] = [
  { key: "employee_id", label: "employee_id", type: "text", origin: "detected" },
  { key: "salary", label: "salary", type: "number", origin: "detected" },
]

const record = (n: number, data: Record<string, unknown>, status = "VALID"): RecordRow => ({
  id: `rec-${n}`,
  record_number: n,
  status,
  data,
})

const build = (records: RecordRow[], errors: RecordErrorRow[] = []) =>
  toTableData({
    requestId: "req_1",
    schemaId: "sch_1",
    fileId: "file_1",
    fileName: "employees_1.csv",
    tableLabel: "employees_1",
    fields,
    records,
    errors,
  })

describe("toTableData", () => {
  it("keys each cell by field, in the order the schema lists them", () => {
    const table = build([record(1, { employee_id: "1001", salary: 72000 })])

    expect(table.fields.map((f) => f.key)).toEqual(["employee_id", "salary"])
    expect(table.rows[0].values.employee_id.display).toBe("1001")
    // Numbers arrive as numbers from jsonb and have to reach the cell as text.
    expect(table.rows[0].values.salary.display).toBe("72000")
    expect(table.rows[0].values.salary.state).toBe("value")
  })

  it("gives every cell an id that survives a round trip to evidence", () => {
    const table = build([record(1, { employee_id: "1001", salary: 72000 })])
    expect(table.rows[0].values.salary.valueId).toBe("rec-1:salary")
  })

  it("says not-found rather than blank when the record has no such field", () => {
    // What a schema edited after processing looks like: the field is asked
    // for, and nothing in the data answers it.
    const table = build([record(1, { employee_id: "1001" })])
    expect(table.rows[0].values.salary.state).toBe("not-found")
    expect(table.rows[0].values.salary.display).toBe("")
  })

  it("marks the one cell an error names, and carries the reason onto it", () => {
    const table = build(
      [record(1, { employee_id: "1001", salary: "not a number" })],
      [{ record_number: 1, field_name: "salary", message: "Couldn't read 'not a number' as a number." }],
    )

    const cell = table.rows[0].values.salary
    expect(cell.state).toBe("marked")
    expect(cell.reason).toMatch(/not a number/)
    // The neighbouring cell is untouched — an error is per value, not per row.
    expect(table.rows[0].values.employee_id.state).toBe("value")
  })

  it("fails the whole row for an error that names no field", () => {
    const table = build(
      [record(1, { employee_id: "1001", salary: 1 })],
      [{ record_number: 1, field_name: null, message: "This line had 3 columns, not 5." }],
    )
    expect(table.rows[0].failed?.message).toMatch(/3 columns/)
  })

  it("fails a row the worker itself did not call valid", () => {
    const table = build([record(1, { employee_id: "1001" }, "INVALID")])
    expect(table.rows[0].failed).toBeDefined()
  })

  it("leaves a good row with no failure at all, rather than an empty one", () => {
    const table = build([record(1, { employee_id: "1001", salary: 1 })])
    expect(table.rows[0].failed).toBeUndefined()
  })

  it("scopes an error to its own record, not to every row sharing the field", () => {
    const table = build(
      [record(1, { salary: 1 }), record(2, { salary: 2 })],
      [{ record_number: 2, field_name: "salary", message: "off" }],
    )
    expect(table.rows[0].values.salary.state).toBe("value")
    expect(table.rows[1].values.salary.state).toBe("marked")
  })

  it("reports no page range, because a record source has no pages", () => {
    expect(build([]).pageRange).toBeNull()
  })
})
