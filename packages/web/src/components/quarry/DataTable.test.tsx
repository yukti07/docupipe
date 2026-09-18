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

  it("actually packs the rows tighter on compact, header included", () => {
    const { container, rerender } = render(
      <DataTable fields={FIELDS} rows={ROWS} density="comfortable" />,
    )
    const cell = () => container.querySelector("[data-cell]")!
    // The density padding is on the header cell's row, which now holds the
    // sort button and the filter button side by side.
    const header = () => container.querySelector("th > div")!

    expect(cell().classList.contains("py-2")).toBe(true)
    expect(header().classList.contains("py-2.5")).toBe(true)

    rerender(<DataTable fields={FIELDS} rows={ROWS} density="compact" />)
    expect(cell().classList.contains("py-1")).toBe(true)
    expect(cell().classList.contains("py-2")).toBe(false)
    expect(header().classList.contains("py-1.5")).toBe(true)
  })

  it("filters one column without touching the others", async () => {
    const { container, user } = render(<DataTable fields={FIELDS} rows={ROWS} />)
    // The chip above the table says the filter's text too, so the rows are
    // counted in the body rather than on the page.
    const body = () => within(container.querySelector("tbody")!)

    await user.click(screen.getByRole("button", { name: "Filter invoice_number" }))
    await user.type(screen.getByLabelText(/Keep rows where/), "INV-2")
    await user.click(screen.getByRole("button", { name: "Apply" }))

    expect(body().getByText("INV-2")).toBeVisible()
    expect(body().queryByText("INV-1")).not.toBeInTheDocument()
  })

  it("composes two column filters, and the search box with them", async () => {
    const rows: TableRow[] = [
      { recordId: "a", values: { invoice_number: value("INV-1"), total: value("10.00") } },
      { recordId: "b", values: { invoice_number: value("INV-1"), total: value("20.00") } },
      { recordId: "c", values: { invoice_number: value("INV-2"), total: value("20.00") } },
    ]
    const { container, user } = render(<DataTable fields={FIELDS} rows={rows} />)
    const body = () => within(container.querySelector("tbody")!)

    await user.click(screen.getByRole("button", { name: "Filter invoice_number" }))
    await user.type(screen.getByLabelText(/Keep rows where/), "INV-1")
    await user.click(screen.getByRole("button", { name: "Apply" }))
    expect(body().getAllByText("INV-1")).toHaveLength(2)

    await user.click(screen.getByRole("button", { name: "Filter total" }))
    await user.type(screen.getByLabelText(/Keep rows where/), "20")
    await user.click(screen.getByRole("button", { name: "Apply" }))

    // One row is left: INV-1 at 20.00.
    expect(body().getAllByText("INV-1")).toHaveLength(1)
    expect(body().getByText("20.00")).toBeVisible()
  })

  it("names the filters in force, and clears one where it is read", async () => {
    const { user } = render(<DataTable fields={FIELDS} rows={ROWS} />)

    await user.click(screen.getByRole("button", { name: "Filter invoice_number" }))
    await user.type(screen.getByLabelText(/Keep rows where/), "INV-2")
    await user.click(screen.getByRole("button", { name: "Apply" }))

    const chip = screen.getByRole("button", { name: "Remove the filter on invoice_number" })
    expect(chip).toBeVisible()

    await user.click(chip)
    expect(screen.getByText("INV-1")).toBeVisible()

    expect(
      screen.queryByRole("button", { name: "Remove the filter on invoice_number" }),
    ).not.toBeInTheDocument()
  })

  it("blames the filter, not the search box, when a filter is what emptied the table", async () => {
    const { user } = render(<DataTable fields={FIELDS} rows={ROWS} />)

    await user.click(screen.getByRole("button", { name: "Filter invoice_number" }))
    await user.type(screen.getByLabelText(/Keep rows where/), "nothing-matches-this")
    await user.click(screen.getByRole("button", { name: "Apply" }))

    expect(screen.getByText("No rows match")).toBeVisible()
    expect(screen.getByText(/No row passes the filter above/)).toBeVisible()
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
