import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@/test/render"
import { ApiError, api } from "@/lib/api"
import type { MergeGroup, SchemaField } from "@/lib/api/types"
import { MergePicker } from "./MergePicker"

const f = (key: string, type: SchemaField["type"]): SchemaField => ({
  key,
  label: key,
  type,
  origin: "detected",
})

const member = (schemaId: string, fileName: string, tableLabel = "table 1") => ({
  schemaId,
  fileId: `file_${schemaId}`,
  fileName,
  tableLabel,
  rowCount: 14,
  toCheckCount: 0,
  convertedAt: "2026-09-14T10:41:00Z",
})

const GROUPS: MergeGroup[] = [
  {
    shapeHash: "9c1f",
    name: "Invoice totals",
    fields: [f("invoice_number", "text"), f("total", "currency")],
    members: [member("sch_31", "invoice-1043.pdf"), member("sch_32", "invoice-1044.pdf")],
  },
  {
    shapeHash: "4b7e",
    name: "Line items",
    fields: [f("invoice_number", "number"), f("line_total", "currency")],
    members: [member("sch_lines_b", "credit-notes.xlsx", "Sheet 2 · Line items")],
  },
]

/** Two shapes that can each be combined on their own. */
const TWO_MERGEABLE: MergeGroup[] = [
  GROUPS[0],
  {
    shapeHash: "4b7e",
    name: "Line items",
    fields: [f("invoice_number", "number"), f("line_total", "currency")],
    members: [member("sch_a", "credit-notes.xlsx", "Sheet 2"), member("sch_b", "notes.xlsx", "Sheet 2")],
  },
]

const merged = vi.fn()

describe("MergePicker", () => {
  it("groups identical shapes with a count and the fields they share", () => {
    render(<MergePicker groups={GROUPS} onMerge={vi.fn()} onMerged={merged} />)
    expect(screen.getByText("2 tables · Invoice totals")).toBeVisible()
    expect(screen.getByText(/invoice_number · text/)).toBeVisible()
  })

  it("keeps merge shut with nothing selected, and says what to do", () => {
    render(<MergePicker groups={GROUPS} onMerge={vi.fn()} onMerged={merged} />)
    expect(screen.getByText("Tick the tables you want combined")).toBeVisible()
    expect(screen.getByRole("button", { name: /^Merge —/ })).toBeDisabled()
  })

  it("says so when only one table is picked", async () => {
    const { user } = render(<MergePicker groups={GROUPS} onMerge={vi.fn()} onMerged={merged} />)
    await user.click(screen.getByRole("checkbox", { name: "invoice-1043.pdf · table 1" }))
    expect(screen.getByText("Pick at least two tables to combine")).toBeVisible()
  })

  it("shows a dash on a partly-picked group", async () => {
    const { user } = render(<MergePicker groups={GROUPS} onMerge={vi.fn()} onMerged={merged} />)
    await user.click(screen.getByRole("checkbox", { name: "invoice-1043.pdf · table 1" }))
    expect(
      screen.getByRole("checkbox", { name: /Select all 2 tables with the Invoice totals shape/ }),
    ).toHaveAttribute("data-state", "indeterminate")
  })

  it("selects a whole group in one click", async () => {
    const { user } = render(<MergePicker groups={GROUPS} onMerge={vi.fn()} onMerged={merged} />)
    await user.click(
      screen.getByRole("checkbox", { name: /Select all 2 tables with the Invoice totals shape/ }),
    )
    expect(screen.getByRole("button", { name: /Merge 2 tables/ })).toBeEnabled()
    expect(screen.getByText("28 rows in one table")).toBeVisible()
  })

  it("offers no page-wide Select all while the page holds several shapes", () => {
    render(<MergePicker groups={GROUPS} onMerge={vi.fn()} onMerged={merged} />)
    // Across shapes, "all" could only ever produce a refusal. Each card's own
    // box is the select-all that means something.
    expect(screen.queryByRole("button", { name: "Select all" })).not.toBeInTheDocument()
    expect(
      screen.getByRole("checkbox", { name: /Select all 2 tables with the Invoice totals shape/ }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole("checkbox").every((box) => box.getAttribute("data-state") !== "checked")).toBe(
      true,
    )
  })

  it("offers Select all when there is only one shape on the page, and not as the default", async () => {
    const { user } = render(<MergePicker groups={[GROUPS[0]]} onMerge={vi.fn()} onMerged={merged} />)
    const all = screen.getByRole("button", { name: "Select all" })
    expect(screen.getAllByRole("checkbox").every((box) => box.getAttribute("data-state") !== "checked")).toBe(
      true,
    )
    await user.click(all)
    expect(screen.getByRole("button", { name: /Merge 2 tables/ })).toBeEnabled()
  })

  it("closes every other shape the moment one table is ticked", async () => {
    const { user } = render(
      <MergePicker groups={TWO_MERGEABLE} onMerge={vi.fn()} onMerged={merged} />,
    )
    await user.click(screen.getByRole("checkbox", { name: "invoice-1043.pdf \u00b7 table 1" }))

    // The other shape stays on screen with its fields \u2014 it is closed, not hidden.
    expect(screen.getByText("2 tables \u00b7 Line items")).toBeVisible()
    expect(screen.getByRole("checkbox", { name: "credit-notes.xlsx \u00b7 Sheet 2" })).toBeDisabled()
    expect(screen.getByText(/Different fields from the 2 tables in Invoice totals/)).toBeVisible()

    // And it opens again once nothing is holding the selection.
    await user.click(screen.getByRole("checkbox", { name: "invoice-1043.pdf \u00b7 table 1" }))
    expect(screen.getByRole("checkbox", { name: "credit-notes.xlsx \u00b7 Sheet 2" })).toBeEnabled()
  })

  it("keeps a lone table visible, and says why it cannot be combined", () => {
    render(<MergePicker groups={GROUPS} onMerge={vi.fn()} onMerged={merged} />)
    expect(screen.getByText("1 table \u00b7 Line items")).toBeVisible()
    expect(
      screen.getByRole("checkbox", { name: "credit-notes.xlsx \u00b7 Sheet 2 \u00b7 Line items" }),
    ).toBeDisabled()
    expect(screen.getByText(/a table can't be combined with itself/)).toBeVisible()
  })

  it("puts the conflict on the offending card, naming the field and the disagreement", async () => {
    const { user } = render(
      <MergePicker
        groups={GROUPS}
        onMerge={(schemaIds, name) => api.createMerge("req_1", schemaIds, name)}
        onMerged={merged}
      />,
    )
    // A selection the picker itself would block is forced through to prove the
    // server's refusal lands on the card rather than only in a summary.
    await user.click(
      screen.getByRole("checkbox", { name: /Select all 2 tables with the Invoice totals shape/ }),
    )
    await user.click(screen.getByRole("button", { name: /Merge 2 tables/ }))

    await waitFor(() => expect(merged).toHaveBeenCalled())
  })

  it("preserves the selection when a merge is refused", async () => {
    const onMerge = vi.fn().mockResolvedValue({
      ok: false,
      failure: { class: "merge_incompatible" },
      conflicts: [
        {
          field: "invoice_number",
          groups: [
            { type: "text", tableNames: ["invoice-1043.pdf · table 1"] },
            { type: "number", tableNames: ["credit-notes.xlsx · Sheet 2 · Line items"] },
          ],
        },
      ],
    })
    const { user } = render(
      <MergePicker groups={GROUPS} onMerge={onMerge} onMerged={merged} />,
    )
    await user.click(
      screen.getByRole("checkbox", { name: /Select all 2 tables with the Invoice totals shape/ }),
    )
    await user.click(screen.getByRole("button", { name: /Merge 2 tables/ }))

    const card = (await screen.findByText("2 tables · Invoice totals")).closest("section")!
    expect(within(card).getByText("invoice_number")).toBeVisible()
    // The sentence is built from several nodes, so it is read off the card whole.
    expect(card.textContent).toContain("text in 1 table — invoice-1043.pdf · table 1")
    expect(card.textContent).toContain("number in 1 table — credit-notes.xlsx · Sheet 2 · Line items")
    expect(screen.getByRole("checkbox", { name: "invoice-1043.pdf · table 1" })).toBeChecked()
  })

  it("says so when the request throws rather than refusing, and lets you go again", async () => {
    // A refusal is an answer and carries its conflicts. A thrown request has
    // neither, and used to leave the button on "Merging…" for good.
    const onMerge = vi.fn().mockRejectedValue(
      new ApiError({ class: "not_implemented", message: "No endpoint yet." }, 501, null),
    )
    const { user } = render(<MergePicker groups={GROUPS} onMerge={onMerge} onMerged={merged} />)
    await user.click(
      screen.getByRole("checkbox", { name: /Select all 2 tables with the Invoice totals shape/ }),
    )
    await user.click(screen.getByRole("button", { name: /Merge 2 tables/ }))

    expect(await screen.findByText("No endpoint yet.")).toBeVisible()
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Merge 2 tables/ })).toBeEnabled(),
    )
  })

  it("says so when every table in the batch has a shape of its own", () => {
    const lone = { ...GROUPS[1], shapeHash: "aaaa", name: "Something else" }
    render(<MergePicker groups={[lone, GROUPS[1]]} onMerge={vi.fn()} onMerged={merged} />)
    expect(screen.getByText("No two tables in this batch share a shape")).toBeVisible()
  })

  it("says there is nothing to combine when the batch holds one table", () => {
    render(
      <MergePicker groups={[GROUPS[1]]} onMerge={vi.fn()} onMerged={merged} />,
    )
    expect(screen.getByText("There's only one table in this batch")).toBeVisible()
  })
})
