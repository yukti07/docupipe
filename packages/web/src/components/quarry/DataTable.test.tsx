import { describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@/test/render"
import type { CellValue, SchemaField, TableRow } from "@/lib/api/types"
import { DataCell } from "./DataCell"
import { DataTable } from "./DataTable"

const field = (key: string, type: SchemaField["type"] = "text"): SchemaField => ({
  key,
  label: key,
  type,
  origin: "detected",
})

const value = (display: string, state: CellValue["state"] = "value", reason?: string): CellValue => ({
  valueId: `val_${display || "none"}`,
  display,
  state,
  ...(reason ? { reason } : {}),
})

const FIELDS = [field("invoice_number"), field("total", "currency")]

const ROWS: TableRow[] = [
  { recordId: "r1", values: { invoice_number: value("INV-1"), total: value("10.00") } },
  { recordId: "r2", values: { invoice_number: value("INV-2"), total: value("", "not-found") } },
  {
    recordId: "r3",
    values: {
      invoice_number: value("INV-3"),
      total: value("216.40", "marked", "20% of 3,480.00 would be 696.00."),
    },
  },
  {
    recordId: "r4",
    failed: {
      class: "field_unresolved",
      message: "The scan is cut off at the right edge.",
    },
    values: { invoice_number: value("INV-4"), total: value("0.00") },
  },
]

describe("DataCell", () => {
  it("renders a value with tabular figures", () => {
    const { container } = render(<DataCell value={value("1,488.00")} />)
    expect(container.querySelector(".tabular-nums")).toHaveTextContent("1,488.00")
  })

  it("says not found in italics rather than leaving a blank to misread", () => {
    render(<DataCell value={value("", "not-found")} />)
    const cell = screen.getByText("not found")
    expect(cell.className).toContain("italic")
    expect(cell.className).toContain("text-muted-foreground")
  })

  it("never substitutes a zero for not found", () => {
    render(<DataCell value={value("", "not-found")} />)
    expect(screen.queryByText("0")).not.toBeInTheDocument()
    expect(screen.queryByText("0.00")).not.toBeInTheDocument()
  })

  it("treats a zero as a value, because a zero is a claim the document made", () => {
    render(<DataCell value={value("0.00")} />)
    expect(screen.getByText("0.00")).toBeVisible()
    expect(screen.queryByText("not found")).not.toBeInTheDocument()
  })

  it("marks a cell with a glyph and its reason inline, not only with colour", () => {
    const { container } = render(
      <DataCell value={value("216.40", "marked", "20% of 3,480.00 would be 696.00.")} />,
    )
    expect(screen.getByText("20% of 3,480.00 would be 696.00.")).toBeVisible()
    expect(container.querySelector("svg")).toBeTruthy()
    expect(container.querySelector("[data-cell=marked]")?.className).toContain("bg-review-cell")
  })

  it("greys and labels a cell on a row the document could not yield", () => {
    const { container } = render(<DataCell value={value("0.00")} failedRow />)
    expect(screen.getByText("not found")).toBeVisible()
    expect(container.querySelector("[data-cell=failed-row]")).toBeTruthy()
  })

  it("opens evidence from any cell, marked or not", async () => {
    const onOpenEvidence = vi.fn()
    const { user } = render(
      <DataCell value={value("1,488.00")} onOpenEvidence={onOpenEvidence} />,
    )
    await user.click(screen.getByRole("button", { name: /1,488.00 — show where this came from/ }))
    expect(onOpenEvidence).toHaveBeenCalledWith("val_1,488.00")
  })
})

describe("DataTable", () => {
  it("renders one column per field and one row per record", () => {
    render(<DataTable fields={FIELDS} rows={ROWS} />)
    expect(screen.getAllByRole("columnheader")).toHaveLength(2)
    expect(screen.getAllByRole("row")).toHaveLength(ROWS.length + 1)
  })

  it("sorts on a column without losing any rows", async () => {
    const { user } = render(<DataTable fields={FIELDS} rows={ROWS} />)
    await user.click(screen.getByRole("button", { name: "Sort by invoice_number" }))
    const body = screen.getAllByRole("row").slice(1)
    expect(within(body[0]).getByText("INV-1")).toBeVisible()
    expect(body).toHaveLength(ROWS.length)
  })

  it("narrows to matching rows as the search changes", () => {
    render(<DataTable fields={FIELDS} rows={ROWS} globalFilter="INV-2" />)
    const body = screen.getAllByRole("row").slice(1)
    expect(body).toHaveLength(1)
    expect(within(body[0]).getByText("INV-2")).toBeVisible()
  })

  it("says why the table is empty when a filter matched nothing", () => {
    render(<DataTable fields={FIELDS} rows={ROWS} globalFilter="nothing matches this" />)
    expect(screen.getByText("No rows match your search")).toBeVisible()
    expect(screen.getByText(/Clear the search to see all 4 rows/)).toBeVisible()
  })

  it("explains an empty table rather than showing a blank grid", () => {
    render(<DataTable fields={FIELDS} rows={[]} />)
    expect(screen.getByText("This file produced no rows")).toBeVisible()
  })

  it("marks the failed row and states its reason under the table", () => {
    const { container } = render(<DataTable fields={FIELDS} rows={ROWS} />)
    expect(container.querySelector("tr[data-failed]")).toBeTruthy()
    expect(screen.getByText(/scan is cut off at the right edge/)).toBeVisible()
  })

  it("adds a source column for a merged table and nothing else", () => {
    render(
      <DataTable
        fields={FIELDS}
        rows={ROWS}
        sourceColumn={{ header: "source_file", value: () => "invoice-1044.pdf" }}
      />,
    )
    expect(screen.getAllByRole("columnheader")).toHaveLength(3)
    expect(screen.getAllByText("invoice-1044.pdf")).toHaveLength(ROWS.length)
  })

  it("windows the body once a table is bigger than a hundred rows", () => {
    const many: TableRow[] = Array.from({ length: 400 }, (_, i) => ({
      recordId: `r${i}`,
      values: { invoice_number: value(`INV-${i}`), total: value(`${i}.00`) },
    }))
    render(<DataTable fields={FIELDS} rows={many} />)
    expect(screen.getAllByRole("row").length).toBeLessThan(many.length)
  })
})
