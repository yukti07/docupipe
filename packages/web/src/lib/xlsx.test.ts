import { describe, expect, it } from "vitest"
import type { CellValue, SchemaField, TableRow } from "@/lib/api/types"
import { cellValue, sheetName, sheetRows } from "./xlsx"

const field = (key: string, type: SchemaField["type"] = "text"): SchemaField => ({
  key,
  label: key,
  type,
  origin: "detected",
})

const value = (display: string, state: CellValue["state"] = "value"): CellValue => ({
  valueId: `val_${display || "none"}`,
  display,
  state,
})

describe("sheetName", () => {
  it("drops the extension and the characters Excel refuses", () => {
    expect(sheetName("invoice[2026]:March/final.pdf", new Set())).toBe("invoice 2026 March final")
  })

  it("truncates to Excel's 31 characters", () => {
    const name = sheetName("a-very-long-file-name-that-will-not-fit-in-a-tab.pdf", new Set())
    expect(name).toHaveLength(31)
  })

  it("de-duplicates, and does so within the limit rather than past it", () => {
    const taken = new Set<string>()
    const long = "invoice-2026-03-north-region-summary.pdf"
    const first = sheetName(long, taken)
    const second = sheetName(long, taken)

    expect(second).not.toBe(first)
    expect(second.length).toBeLessThanOrEqual(31)
    expect(second.endsWith(" (2)")).toBe(true)
  })

  it("falls back rather than producing an empty tab name", () => {
    expect(sheetName("///.pdf", new Set())).toBe("Sheet")
  })
})

describe("cellValue", () => {
  it("writes a numeric field as a number, separators and symbol removed", () => {
    expect(cellValue("1,488.00", "currency")).toBe(1488)
    expect(cellValue("£1,488.00", "currency")).toBe(1488)
    expect(cellValue("-12", "number")).toBe(-12)
  })

  it("leaves a numeric field alone when its text is not actually a number", () => {
    expect(cellValue("n/a", "number")).toBe("n/a")
    expect(cellValue("12-14", "number")).toBe("12-14")
  })

  it("never coerces a text field, however numeric it looks", () => {
    // An invoice reference is not a quantity, and 1.044e3 is not an answer.
    expect(cellValue("1044", "text")).toBe("1044")
  })
})

describe("sheetRows", () => {
  const fields = [field("invoice_number"), field("total", "currency")]

  it("exports a value that was not found as an empty cell, never as a zero", () => {
    const rows: TableRow[] = [
      { recordId: "r1", values: { invoice_number: value("INV-1"), total: value("", "not-found") } },
    ]
    const [, first] = sheetRows({ name: "x.pdf", fields, rows })
    expect(first[1]).toBeNull()
  })

  it("puts the source column first on a merged table", () => {
    const rows: TableRow[] = [
      {
        recordId: "r1",
        sourceFile: "invoice-1043.pdf · table 1",
        values: { invoice_number: value("INV-1"), total: value("10.00") },
      },
    ]
    const [header, first] = sheetRows({
      name: "Combined",
      fields,
      rows,
      sourceColumn: { header: "source_file", value: (row) => row.sourceFile ?? "" },
    })

    expect(header).toEqual(["source_file", "invoice_number", "total"])
    expect(first[0]).toBe("invoice-1043.pdf · table 1")
    expect(first[2]).toBe(10)
  })
})
