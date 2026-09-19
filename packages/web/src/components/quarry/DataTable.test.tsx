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

  it("filters the source column as the text it is, with no type to claim", async () => {
    const rows: TableRow[] = [
      {
        recordId: "a",
        sourceFile: "invoice-1044.pdf",
        values: { invoice_number: value("INV-1"), total: value("10.00") },
      },
      {
        recordId: "b",
        sourceFile: "invoice-2000.pdf",
        values: { invoice_number: value("INV-2"), total: value("20.00") },
      },
    ]
    const { container, user } = render(
      <DataTable
        fields={FIELDS}
        rows={rows}
        sourceColumn={{ header: "source_file", value: (row) => row.sourceFile ?? "" }}
      />,
    )
    const body = () => within(container.querySelector("tbody")!)

    // It is not a schema field, so it carries no type badge — but it is still
    // filterable, and as text rather than as whatever the first field happens
    // to be.
    const header = screen.getAllByRole("columnheader")[0]
    expect(within(header).queryByText("text")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Filter source_file" }))
    await user.type(screen.getByLabelText("Value for source_file"), "1044")
    await user.click(screen.getByRole("button", { name: "Apply" }))

    expect(body().getByText("invoice-1044.pdf")).toBeVisible()
    expect(body().queryByText("invoice-2000.pdf")).not.toBeInTheDocument()
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
    await user.type(screen.getByLabelText("Value for invoice_number"), "INV-2")
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
    await user.type(screen.getByLabelText("Value for invoice_number"), "INV-1")
    await user.click(screen.getByRole("button", { name: "Apply" }))
    expect(body().getAllByText("INV-1")).toHaveLength(2)

    await user.click(screen.getByRole("button", { name: "Filter total" }))
    await user.type(screen.getByLabelText("Value for total"), "15")
    await user.click(screen.getByRole("button", { name: "Apply" }))

    // One row is left: INV-1 at 20.00 — the only one over 15.
    expect(body().getAllByText("INV-1")).toHaveLength(1)
    expect(body().getByText("20.00")).toBeVisible()
  })

  it("names the filters in force as a sentence, and clears one where it is read", async () => {
    const { user } = render(<DataTable fields={FIELDS} rows={ROWS} />)

    await user.click(screen.getByRole("button", { name: "Filter total" }))
    await user.type(screen.getByLabelText("Value for total"), "100")
    await user.click(screen.getByRole("button", { name: "Apply" }))

    const chip = screen.getByRole("button", { name: "Remove the filter on total" })
    expect(chip).toBeVisible()
    // The operator is carried in the state, so the chip can say which one it is
    // rather than claiming every filter is a "contains".
    expect(chip).toHaveTextContent("is greater than")
    expect(chip).toHaveTextContent("100")

    await user.click(chip)
    expect(screen.getByText("10.00")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Remove the filter on total" }),
    ).not.toBeInTheDocument()
  })

  it("blames the filter, not the search box, when a filter is what emptied the table", async () => {
    const { user } = render(<DataTable fields={FIELDS} rows={ROWS} />)

    await user.click(screen.getByRole("button", { name: "Filter invoice_number" }))
    await user.type(screen.getByLabelText("Value for invoice_number"), "nothing-matches-this")
    await user.click(screen.getByRole("button", { name: "Apply" }))

    expect(screen.getByText("No rows match")).toBeVisible()
    expect(screen.getByText(/No row passes the filter above/)).toBeVisible()
  })

  it("offers a currency column comparisons, and never offers it contains", async () => {
    const { user } = render(<DataTable fields={FIELDS} rows={ROWS} />)

    await user.click(screen.getByRole("button", { name: "Filter total" }))
    await user.click(screen.getByRole("combobox", { name: "Operator for total" }))

    expect(screen.getByRole("option", { name: "is greater than" })).toBeVisible()
    expect(screen.getByRole("option", { name: "is between" })).toBeVisible()
    expect(screen.queryByRole("option", { name: "contains" })).not.toBeInTheDocument()
  })

  it("offers a text column contains, and never offers it a comparison", async () => {
    const { user } = render(<DataTable fields={FIELDS} rows={ROWS} />)

    await user.click(screen.getByRole("button", { name: "Filter invoice_number" }))
    await user.click(screen.getByRole("combobox", { name: "Operator for invoice_number" }))

    expect(screen.getByRole("option", { name: "contains" })).toBeVisible()
    expect(screen.getByRole("option", { name: "does not contain" })).toBeVisible()
    expect(screen.queryByRole("option", { name: "is greater than" })).not.toBeInTheDocument()
  })

  it("compares a currency column as a number, not as the text contains would match", async () => {
    const { container, user } = render(<DataTable fields={FIELDS} rows={ROWS} />)
    const body = () => within(container.querySelector("tbody")!)

    await user.click(screen.getByRole("button", { name: "Filter total" }))
    await user.type(screen.getByLabelText("Value for total"), "100")
    await user.click(screen.getByRole("button", { name: "Apply" }))

    // 216.40 is over a hundred and 10.00 is not — which is the whole point, and
    // the opposite of what "contains 100" would have returned on either.
    expect(body().getByText("216.40")).toBeVisible()
    expect(body().queryByText("10.00")).not.toBeInTheDocument()
  })

  it("keeps a range inclusive at both ends", async () => {
    const { container, user } = render(<DataTable fields={FIELDS} rows={ROWS} />)
    const body = () => within(container.querySelector("tbody")!)

    await user.click(screen.getByRole("button", { name: "Filter total" }))
    await user.click(screen.getByRole("combobox", { name: "Operator for total" }))
    await user.click(screen.getByRole("option", { name: "is between" }))
    await user.type(screen.getByLabelText("Lowest value for total"), "10")
    await user.type(screen.getByLabelText("Highest value for total"), "216.40")
    await user.click(screen.getByRole("button", { name: "Apply" }))

    expect(body().getByText("10.00")).toBeVisible()
    expect(body().getByText("216.40")).toBeVisible()
  })

  it("leaves a cell with no value out of a comparison, and finds it with is empty", async () => {
    const { container, user } = render(<DataTable fields={FIELDS} rows={ROWS} />)
    const body = () => within(container.querySelector("tbody")!)

    await user.click(screen.getByRole("button", { name: "Filter total" }))
    await user.type(screen.getByLabelText("Value for total"), "1")
    await user.click(screen.getByRole("button", { name: "Apply" }))
    expect(body().queryByText("INV-2")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Filter on total/ }))
    await user.click(screen.getByRole("combobox", { name: "Operator for total" }))
    await user.click(screen.getByRole("option", { name: "is empty" }))
    await user.click(screen.getByRole("button", { name: "Apply" }))

    // The one row whose total the document never yielded. Nothing else.
    expect(body().getByText("INV-2")).toBeVisible()
    expect(body().queryByText("INV-3")).not.toBeInTheDocument()
  })

  it("asks for no value at all once the operator does not take one", async () => {
    const { user } = render(<DataTable fields={FIELDS} rows={ROWS} />)

    await user.click(screen.getByRole("button", { name: "Filter total" }))
    expect(screen.getByLabelText("Value for total")).toBeVisible()

    await user.click(screen.getByRole("combobox", { name: "Operator for total" }))
    await user.click(screen.getByRole("option", { name: "is empty" }))

    expect(screen.queryByLabelText("Value for total")).not.toBeInTheDocument()
    // "is empty" is complete on its own, so Apply is live with nothing typed.
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled()
  })

  it("will not apply a filter whose operator is still missing its value", async () => {
    const { user } = render(<DataTable fields={FIELDS} rows={ROWS} />)

    await user.click(screen.getByRole("button", { name: "Filter total" }))
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled()

    await user.type(screen.getByLabelText("Value for total"), "100")
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled()
  })

  it("says how many cells in the column hold no readable number", async () => {
    const rows: TableRow[] = [
      { recordId: "a", values: { invoice_number: value("INV-1"), total: value("10.00") } },
      { recordId: "b", values: { invoice_number: value("INV-2"), total: value("see attached") } },
    ]
    const { user } = render(<DataTable fields={FIELDS} rows={rows} />)

    await user.click(screen.getByRole("button", { name: "Filter total" }))
    expect(screen.getByText(/1 of 2 cells here have no readable number/)).toBeVisible()
  })

  it("does not warn about unreadable cells on a column with nothing to parse", async () => {
    const { user } = render(<DataTable fields={FIELDS} rows={ROWS} />)

    await user.click(screen.getByRole("button", { name: "Filter invoice_number" }))
    expect(screen.queryByText(/no readable/)).not.toBeInTheDocument()
  })

  it("filters a date column chronologically", async () => {
    const fields = [field("invoice_date", "date"), field("supplier")]
    const rows: TableRow[] = [
      {
        recordId: "a",
        values: { invoice_date: value("2026-01-01"), supplier: value("Ferro Castings") },
      },
      {
        recordId: "b",
        values: { invoice_date: value("2026-03-14"), supplier: value("Northgate Paper") },
      },
    ]
    const { container, user } = render(<DataTable fields={fields} rows={rows} />)
    const body = () => within(container.querySelector("tbody")!)

    await user.click(screen.getByRole("button", { name: "Filter invoice_date" }))
    // A date input, so the operand is ISO and never ambiguous about which
    // number is the day.
    const input = screen.getByLabelText("Value for invoice_date")
    expect(input).toHaveAttribute("type", "date")
    await user.type(input, "2026-02-01")
    await user.click(screen.getByRole("button", { name: "Apply" }))

    expect(body().getByText("Northgate Paper")).toBeVisible()
    expect(body().queryByText("Ferro Castings")).not.toBeInTheDocument()
  })

  it("treats a failed row as having no values, the way it already renders", async () => {
    const { container, user } = render(<DataTable fields={FIELDS} rows={ROWS} />)
    const body = () => within(container.querySelector("tbody")!)

    // r4 carries total 0.00 but the row failed, so every cell in it renders
    // "not found". A filter that read the hidden 0.00 would disagree with the
    // screen, so it is empty here as well — and survives "is empty" alongside
    // r2, whose total the document genuinely never yielded.
    await user.click(screen.getByRole("button", { name: "Filter total" }))
    await user.click(screen.getByRole("combobox", { name: "Operator for total" }))
    await user.click(screen.getByRole("option", { name: "is empty" }))
    await user.click(screen.getByRole("button", { name: "Apply" }))

    expect(body().getAllByRole("row")).toHaveLength(2)
    expect(container.querySelector("tbody tr[data-failed]")).not.toBeNull()
  })

  it("does not hand a failed row's hidden figure to a comparison", async () => {
    const { container, user } = render(<DataTable fields={FIELDS} rows={ROWS} />)

    // 0.00 is on r4 and is at most 1, but the row failed, so it is not there
    // to be compared — only the one live row under 1 comes back.
    await user.click(screen.getByRole("button", { name: "Filter total" }))
    await user.click(screen.getByRole("combobox", { name: "Operator for total" }))
    await user.click(screen.getByRole("option", { name: "is at most" }))
    await user.type(screen.getByLabelText("Value for total"), "1")
    await user.click(screen.getByRole("button", { name: "Apply" }))

    expect(screen.getByText("No rows match")).toBeVisible()
    expect(container.querySelector("tbody")).toBeNull()
  })

  it("says each column's declared type in its header, which is the structure itself", () => {
    render(<DataTable fields={FIELDS} rows={ROWS} />)
    const headers = screen.getAllByRole("columnheader")

    expect(within(headers[0]).getByText("text")).toBeVisible()
    expect(within(headers[1]).getByText("currency")).toBeVisible()
  })

  it("drops the type badge on compact, where the row has no room for it", () => {
    const { rerender } = render(<DataTable fields={FIELDS} rows={ROWS} density="comfortable" />)
    expect(screen.getByText("currency")).toBeVisible()

    rerender(<DataTable fields={FIELDS} rows={ROWS} density="compact" />)
    expect(screen.queryByText("currency")).not.toBeInTheDocument()
  })

  it("right-aligns the figures in a currency column and not the text beside them", () => {
    const { container } = render(<DataTable fields={FIELDS} rows={ROWS} />)
    const cells = container.querySelectorAll("[data-cell]")

    expect(cells[0].className).toContain("text-left")
    expect(cells[1].className).toContain("text-right")
  })

  it("gives every column a measured width, so windowed rows cannot re-size the grid", () => {
    const { container } = render(<DataTable fields={FIELDS} rows={ROWS} />)
    const cols = [...container.querySelectorAll("colgroup col")]
    // One per field, plus the trailing spacer that takes the slack.
    expect(cols).toHaveLength(FIELDS.length + 1)
    for (const col of cols.slice(0, FIELDS.length)) {
      expect((col as HTMLElement).style.width).toMatch(/^\d+px$/)
    }
    expect(container.querySelector("table")?.className).toContain("table-fixed")
  })

  it("parks the leftover width in a spacer rather than spreading it over the columns", () => {
    // Fixed layout treats widths that do not fill the box as proportions, so
    // without somewhere for the slack to go a five-column table on a wide
    // screen stretches every column and strands each filter button half a
    // screen from the name it belongs to.
    const { container } = render(<DataTable fields={FIELDS} rows={ROWS} />)
    const spacer = [...container.querySelectorAll("colgroup col")].at(-1) as HTMLElement
    expect(spacer.style.width).toBe("")
    expect(container.querySelectorAll("thead th")).toHaveLength(FIELDS.length + 1)
    for (const row of container.querySelectorAll("tbody tr")) {
      expect(row.querySelectorAll("td")).toHaveLength(FIELDS.length + 1)
    }
  })

  it("narrows the columns on compact, not only the gaps between the rows", () => {
    const widths = (container: HTMLElement) =>
      [...container.querySelectorAll("colgroup col")]
        .slice(0, FIELDS.length)
        .map((col) => Number.parseInt((col as HTMLElement).style.width, 10))

    const { container, rerender } = render(
      <DataTable fields={FIELDS} rows={ROWS} density="comfortable" />,
    )
    const roomy = widths(container)

    rerender(<DataTable fields={FIELDS} rows={ROWS} density="compact" />)
    const tight = widths(container)

    expect(tight.every((w, i) => w < roomy[i])).toBe(true)
  })

  it("moves a column with the arrow keys, without touching what is in it", async () => {
    const { container, user } = render(<DataTable fields={FIELDS} rows={ROWS} />)
    // The spacer has no column of its own, which is what `data-column` says.
    const headers = () =>
      [...container.querySelectorAll("th[data-column]")].map((th) =>
        th.getAttribute("data-column"),
      )

    expect(headers()).toEqual(["invoice_number", "total"])

    screen.getByRole("button", { name: /Move total/ }).focus()
    await user.keyboard("{ArrowLeft}")

    expect(headers()).toEqual(["total", "invoice_number"])
    // The rows moved with their column rather than being re-read into it.
    const firstRow = container.querySelectorAll("tbody tr")[0]
    expect(within(firstRow as HTMLElement).getByText("10.00")).toBeVisible()
  })

  it("will not walk a column off either end of the table", async () => {
    const { container, user } = render(<DataTable fields={FIELDS} rows={ROWS} />)
    const headers = () =>
      [...container.querySelectorAll("th[data-column]")].map((th) =>
        th.getAttribute("data-column"),
      )

    screen.getByRole("button", { name: /Move invoice_number/ }).focus()
    await user.keyboard("{ArrowLeft}")
    expect(headers()).toEqual(["invoice_number", "total"])
  })

  it("says where a column sits, so the handle can be used without seeing it", () => {
    render(<DataTable fields={FIELDS} rows={ROWS} />)
    expect(
      screen.getByRole("button", { name: "Move invoice_number — column 1 of 2" }),
    ).toBeVisible()
    expect(screen.getByRole("button", { name: "Move total — column 2 of 2" })).toBeVisible()
  })

  it("keeps the filter form open while its operator list is being used", async () => {
    const { user } = render(<DataTable fields={FIELDS} rows={ROWS} />)

    await user.click(screen.getByRole("button", { name: "Filter total" }))
    await user.click(screen.getByRole("combobox", { name: "Operator for total" }))
    await user.click(screen.getByRole("option", { name: "is between" }))

    // The list is attached to the form rather than portalled over it, so
    // picking an operator leaves the value fields it just changed on screen.
    expect(screen.getByRole("combobox", { name: "Operator for total" })).toHaveTextContent(
      "is between",
    )
    expect(screen.getByLabelText("Lowest value for total")).toBeVisible()
    expect(screen.getByLabelText("Highest value for total")).toBeVisible()
    expect(screen.getByRole("button", { name: "Apply" })).toBeVisible()
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
