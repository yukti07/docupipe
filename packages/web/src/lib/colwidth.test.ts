import { describe, expect, it } from "vitest"
import type { CellValue, TableRow } from "@/lib/api/types"
import type { DensityOption } from "@/lib/density"
import { measureColumns, type ColumnSpec } from "./colwidth"

const cell = (display: string): CellValue => ({ valueId: `v_${display}`, display, state: "value" })

const row = (values: Record<string, string>): TableRow => ({
  recordId: `r_${Object.values(values).join("_")}`,
  values: Object.fromEntries(Object.entries(values).map(([key, text]) => [key, cell(text)])),
})

const spec = (id: string, type: ColumnSpec["type"] = "text"): ColumnSpec => ({
  id,
  header: id,
  type,
})

const width = (
  specs: ColumnSpec[],
  rows: TableRow[],
  id: string,
  density: DensityOption = "comfortable",
) => measureColumns(specs, rows, { density }).get(id)!

describe("measureColumns", () => {
  it("gives every column a width", () => {
    const specs = [spec("invoice_number"), spec("total", "currency")]
    const widths = measureColumns(specs, [row({ invoice_number: "INV-1", total: "10.00" })])
    expect([...widths.keys()]).toEqual(["invoice_number", "total"])
  })

  it("never shrinks a column of two-letter codes to the size of its content", () => {
    const specs = [spec("cc")]
    const rows = [row({ cc: "GB" }), row({ cc: "US" })]
    const measured = width(specs, rows, "cc")

    expect(measured).toBeGreaterThanOrEqual(110)
    // Two characters do not reach the floor, so the rows contribute nothing —
    // the same column with no rows at all comes out the same width.
    expect(measured).toBe(width(specs, [], "cc"))
  })

  it("stops a column of long prose at its ceiling", () => {
    const specs = [spec("description")]
    const rows = [row({ description: "A ".repeat(400) })]
    expect(width(specs, rows, "description")).toBe(320)
  })

  it("keeps a figure column narrower than a text one holding the same characters", () => {
    const text = width([spec("a")], [row({ a: "123456789012345678901234567890" })], "a")
    const number = width(
      [spec("a", "number")],
      [row({ a: "123456789012345678901234567890" })],
      "a",
    )
    expect(number).toBeLessThan(text)
    expect(number).toBeLessThanOrEqual(160)
  })

  it("widens a column its own header cannot fit in", () => {
    // Nothing in the body is wide, so the header is what sets the width — the
    // sort control and the filter button ride on the same row as the name.
    const narrow = width([spec("id")], [row({ id: "1" })], "id")
    const wide = width(
      [spec("a_very_long_column_name_indeed")],
      [row({ a_very_long_column_name_indeed: "1" })],
      "a_very_long_column_name_indeed",
    )
    expect(wide).toBeGreaterThan(narrow)
  })

  it("costs the header nothing for a type badge it is not going to draw", () => {
    // Compact drops the badge, so the room it would have taken is the room
    // the column's name gets back.
    const specs = [{ ...spec("a_reasonably_long_name"), badge: "currency" }]
    const rows = [row({ a_reasonably_long_name: "x" })]
    expect(width(specs, rows, "a_reasonably_long_name", "compact")).toBeLessThan(
      width(specs, rows, "a_reasonably_long_name", "comfortable"),
    )
  })

  it("narrows a column on compact, which is what compact is being asked for", () => {
    // Smaller text in tighter padding, a floor that gives way, and no badge:
    // density that only closed the gaps between rows left every column exactly
    // as wide as before.
    const specs = [{ ...spec("description"), badge: "text" }]
    const rows = [row({ description: "A reasonably wide cell of prose here" })]
    expect(width(specs, rows, "description", "compact")).toBeLessThan(
      width(specs, rows, "description", "comfortable"),
    )
  })

  it("narrows a column whose floor is all that is holding it open", () => {
    const specs = [spec("cc")]
    const rows = [row({ cc: "GB" })]
    expect(width(specs, rows, "cc", "compact")).toBeLessThan(
      width(specs, rows, "cc", "comfortable"),
    )
  })

  it("samples the head of the table rather than walking ten thousand rows", () => {
    const specs = [spec("note")]
    const short = Array.from({ length: 200 }, () => row({ note: "ok" }))
    const withLateGiant = [...short]
    withLateGiant[180] = row({ note: "x".repeat(200) })
    // The giant is past the sample, so it does not widen the column. That is
    // the trade the sample makes, and the clamp bounds how wrong it can be.
    expect(width(specs, withLateGiant, "note")).toBe(width(specs, short, "note"))
  })

  it("reads a column that lives on the row rather than in its values", () => {
    const source: ColumnSpec = {
      id: "__source",
      header: "source_file",
      type: "text",
      read: (r) => r.sourceFile ?? "",
    }
    const rows: TableRow[] = [
      { recordId: "a", sourceFile: "a-very-long-invoice-filename.pdf", values: {} },
    ]
    expect(width([source], rows, "__source")).toBeGreaterThan(width([source], [], "__source"))
  })

  it("sizes an empty table from its headers alone", () => {
    expect(width([spec("total", "currency")], [], "total")).toBeGreaterThanOrEqual(92)
  })
})
