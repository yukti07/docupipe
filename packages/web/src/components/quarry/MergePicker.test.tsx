import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@/test/render"
import { api } from "@/lib/api"
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

  it("offers Select all as one click, and not as the default", () => {
    render(<MergePicker groups={GROUPS} onMerge={vi.fn()} onMerged={merged} />)
    expect(screen.getByRole("button", { name: "Select all" })).toBeVisible()
    expect(screen.getAllByRole("checkbox").every((box) => box.getAttribute("data-state") !== "checked")).toBe(
      true,
    )
  })

  it("keeps an incompatible group visible with its fields and a plain reason", async () => {
    const { user } = render(<MergePicker groups={GROUPS} onMerge={vi.fn()} onMerged={merged} />)
    await user.click(screen.getByRole("checkbox", { name: "invoice-1043.pdf · table 1" }))
    await user.click(
      screen.getByRole("checkbox", { name: "credit-notes.xlsx · Sheet 2 · Line items" }),
    )
    expect(screen.getByText("1 table · Line items")).toBeVisible()
    expect(screen.getByText("These tables don't have the same fields and types")).toBeVisible()
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

  it("says there is nothing to combine when the batch holds one table", () => {
    render(
      <MergePicker groups={[GROUPS[1]]} onMerge={vi.fn()} onMerged={merged} />,
    )
    expect(screen.getByText("There's only one table in this batch")).toBeVisible()
  })
})
