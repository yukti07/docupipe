import { describe, expect, it } from "vitest"
import type { CellValue, SchemaField, TableRow } from "@/lib/api/types"
import { csvFileName, toCsv } from "./csv"

const field = (key: string): SchemaField => ({ key, label: key, type: "text", origin: "detected" })
const value = (display: string, state: CellValue["state"] = "value"): CellValue => ({
  valueId: `val_${display}`,
  display,
  state,
})

const table = {
  fields: [field("invoice_number"), field("total")],
  rows: [
    { recordId: "r1", values: { invoice_number: value("INV-1"), total: value("10.00") } },
    {
      recordId: "r2",
      values: { invoice_number: value("INV-2"), total: value("", "not-found") },
    },
    {
      recordId: "r3",
      values: {
        invoice_number: value("INV-3"),
        total: { ...value("216.40", "marked"), reason: "checked and it did not add up" },
      },
    },
  ] as TableRow[],
}

describe("toCsv", () => {
  it("writes a header from the field keys", () => {
    expect(toCsv(table).text.split("\r\n")[0]).toBe("invoice_number,total")
  })

  it("exports not found as an empty cell, never as 0", () => {
    const { text, summary } = toCsv(table)
    const row = text.split("\r\n")[2]
    expect(row).toBe("INV-2,")
    expect(row).not.toContain("0")
    expect(summary.notFound).toBe(1)
  })

  it("counts the marked cells so the summary can say how many there were", () => {
    expect(toCsv(table).summary).toMatchObject({ rows: 3, marked: 1, notFound: 1 })
  })

  it("counts rows the document could not yield", () => {
    const withFailed = {
      ...table,
      rows: [...table.rows, { recordId: "r4", failed: { class: "field_unresolved" as const }, values: {} }],
    }
    expect(toCsv(withFailed).summary.failedRows).toBe(1)
  })

  it("quotes a cell that holds the delimiter or a quote", () => {
    const tricky = {
      fields: [field("supplier")],
      rows: [{ recordId: "r1", values: { supplier: value('Ferro, "the castings people"') } }],
    }
    expect(toCsv(tricky).text.split("\r\n")[1]).toBe('"Ferro, ""the castings people"""')
  })

  it("writes tabs when asked for them", () => {
    expect(toCsv(table, { delimiter: "\t" }).text.split("\r\n")[0]).toBe("invoice_number\ttotal")
  })

  it("defuses a cell a spreadsheet would read as a formula", () => {
    const risky = {
      fields: [field("note")],
      rows: [{ recordId: "r1", values: { note: value("=SUM(A1:A9)") } }],
    }
    expect(toCsv(risky).text.split("\r\n")[1]).toBe("'=SUM(A1:A9)")
  })

  it("adds a source column for a merged table", () => {
    const { text } = toCsv(table, { sourceColumn: () => "invoice-1044.pdf" })
    expect(text.split("\r\n")[0]).toBe("source_file,invoice_number,total")
    expect(text.split("\r\n")[1]).toBe("invoice-1044.pdf,INV-1,10.00")
  })
})

describe("csvFileName", () => {
  it("swaps the source extension for the export one", () => {
    expect(csvFileName("invoice-1044.pdf")).toBe("invoice-1044.csv")
    expect(csvFileName("invoice-1044.pdf", "tsv")).toBe("invoice-1044.tsv")
  })
})
