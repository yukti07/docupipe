import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@/test/render"
import { ApiError } from "@/lib/api"
import type { MergeGroup, MergeOverview, MergedTable, SchemaField } from "@/lib/api/types"
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

const INVOICES: MergeGroup = {
  shapeHash: "9c1f",
  name: "Invoice totals",
  fields: [f("invoice_number", "text"), f("total", "currency")],
  members: [member("sch_31", "invoice-1043.pdf"), member("sch_32", "invoice-1044.pdf")],
}

const LONE_LINES: MergeGroup = {
  shapeHash: "4b7e",
  name: "Line items",
  fields: [f("invoice_number", "number"), f("line_total", "currency")],
  members: [member("sch_lines_b", "credit-notes.xlsx", "Sheet 2 · Line items")],
}

const LINES: MergeGroup = {
  shapeHash: "4b7e",
  name: "Line items",
  fields: [f("invoice_number", "number"), f("line_total", "currency")],
  members: [
    member("sch_a", "credit-notes.xlsx", "Sheet 2"),
    member("sch_b", "notes.xlsx", "Sheet 2"),
    member("sch_c", "more-notes.xlsx", "Sheet 2"),
  ],
}

const overview = (groups: MergeGroup[], merges: MergedTable[] = []): MergeOverview => ({
  groups,
  merges,
  tableCount: groups.reduce((n, g) => n + g.members.length, 0) + merges.length,
})

const merged = vi.fn()
const noop = async () => {}

describe("MergePicker", () => {
  it("groups identical shapes with a count and the fields they share", () => {
    render(
      <MergePicker
        overview={overview([INVOICES, LONE_LINES])}
        onMerge={vi.fn()}
        onUndo={noop}
        onMerged={merged}
      />,
    )
    expect(screen.getByText("2 tables · Invoice totals")).toBeVisible()
    expect(screen.getByText(/invoice_number · text/)).toBeVisible()
  })

  it("keeps combine shut with nothing selected, and says what to do", () => {
    render(
      <MergePicker
        overview={overview([INVOICES, LONE_LINES])}
        onMerge={vi.fn()}
        onUndo={noop}
        onMerged={merged}
      />,
    )
    expect(screen.getByText("Tick the tables you want combined")).toBeVisible()
    expect(screen.getByRole("button", { name: /^Combine —/ })).toBeDisabled()
  })

  it("says so when only one table is picked", async () => {
    const { user } = render(
      <MergePicker
        overview={overview([INVOICES, LONE_LINES])}
        onMerge={vi.fn()}
        onUndo={noop}
        onMerged={merged}
      />,
    )
    await user.click(screen.getByRole("checkbox", { name: "invoice-1043.pdf · table 1" }))
    expect(screen.getByText("Pick at least two tables in a group")).toBeVisible()
  })

  it("shows a dash on a partly-picked group", async () => {
    const { user } = render(
      <MergePicker
        overview={overview([INVOICES, LONE_LINES])}
        onMerge={vi.fn()}
        onUndo={noop}
        onMerged={merged}
      />,
    )
    await user.click(screen.getByRole("checkbox", { name: "invoice-1043.pdf · table 1" }))
    expect(
      screen.getByRole("checkbox", { name: /Select all 2 tables with the Invoice totals shape/ }),
    ).toHaveAttribute("data-state", "indeterminate")
  })

  it("selects a whole group in one click and asks what to call it", async () => {
    const { user } = render(
      <MergePicker
        overview={overview([INVOICES, LONE_LINES])}
        onMerge={vi.fn()}
        onUndo={noop}
        onMerged={merged}
      />,
    )
    await user.click(
      screen.getByRole("checkbox", { name: /Select all 2 tables with the Invoice totals shape/ }),
    )
    expect(screen.getByRole("button", { name: /Combine 2 tables/ })).toBeEnabled()
    expect(screen.getByLabelText("Name for these 2 tables")).toBeVisible()
  })

  /**
   * The whole point of the rewrite. Four tables of one shape and two of another
   * used to be impossible: ticking one shape closed every other.
   */
  it("combines two shapes in one submit, each into its own table", async () => {
    const onMerge = vi.fn().mockResolvedValue({ ok: true, merges: [], tableCount: 2 })
    const { user } = render(
      <MergePicker
        overview={overview([INVOICES, LINES])}
        onMerge={onMerge}
        onUndo={noop}
        onMerged={merged}
      />,
    )

    await user.click(
      screen.getByRole("checkbox", { name: /Select all 2 tables with the Invoice totals shape/ }),
    )
    await user.click(screen.getByRole("checkbox", { name: "credit-notes.xlsx · Sheet 2" }))
    await user.click(screen.getByRole("checkbox", { name: "notes.xlsx · Sheet 2" }))

    // Two of the three line-item tables, so the third is left on its own. Both
    // cards now ask for a name, so this one is found on the card it belongs to.
    const invoices = screen.getByText("2 tables · Invoice totals").closest("section")!
    await user.type(within(invoices).getByLabelText(/Name for these 2 tables/), "August invoices")
    await user.click(screen.getByRole("button", { name: /Combine 4 tables into 2/ }))

    await waitFor(() => expect(onMerge).toHaveBeenCalled())
    const submitted = onMerge.mock.calls[0][0]
    expect(submitted).toHaveLength(2)
    expect(submitted[0].schemaIds).toEqual(["sch_31", "sch_32"])
    expect(submitted[1].schemaIds).toEqual(["sch_a", "sch_b"])
    // Left blank, so the group's own name stands in rather than an empty string.
    expect(submitted[1].name).toBe("Line items")
  })

  it("counts what the batch will hold afterwards", async () => {
    const { user } = render(
      <MergePicker
        overview={overview([INVOICES, LINES])}
        onMerge={vi.fn()}
        onUndo={noop}
        onMerged={merged}
      />,
    )
    await user.click(
      screen.getByRole("checkbox", { name: /Select all 2 tables with the Invoice totals shape/ }),
    )
    // 5 tables, two of which become one.
    expect(screen.getByText("5 tables in this batch → 4")).toBeVisible()
  })

  it("keeps a lone table visible, and says why it cannot be combined", () => {
    render(
      <MergePicker
        overview={overview([INVOICES, LONE_LINES])}
        onMerge={vi.fn()}
        onUndo={noop}
        onMerged={merged}
      />,
    )
    expect(screen.getByText("1 table · Line items")).toBeVisible()
    expect(
      screen.getByRole("checkbox", { name: "credit-notes.xlsx · Sheet 2 · Line items" }),
    ).toBeDisabled()
    expect(screen.getByText(/a table can't be combined with itself/)).toBeVisible()
  })

  it("preserves the selection when a merge is refused, and names the card", async () => {
    const onMerge = vi.fn().mockResolvedValue({
      ok: false,
      failure: { class: "merge_incompatible" },
      conflicts: [
        {
          field: "invoice_number",
          shapeHash: "9c1f",
          groups: [
            { type: "text", tableNames: ["invoice-1043.pdf · table 1"] },
            { type: "number", tableNames: ["invoice-1044.pdf · table 1"] },
          ],
        },
      ],
    })
    const { user } = render(
      <MergePicker
        overview={overview([INVOICES, LONE_LINES])}
        onMerge={onMerge}
        onUndo={noop}
        onMerged={merged}
      />,
    )
    await user.click(
      screen.getByRole("checkbox", { name: /Select all 2 tables with the Invoice totals shape/ }),
    )
    await user.click(screen.getByRole("button", { name: /Combine 2 tables/ }))

    const card = (await screen.findByText("2 tables · Invoice totals")).closest("section")!
    expect(within(card).getByText("invoice_number")).toBeVisible()
    // The sentence is built from several nodes, so it is read off the card whole.
    expect(card.textContent).toContain("text in 1 table — invoice-1043.pdf · table 1")
    expect(screen.getByRole("checkbox", { name: "invoice-1043.pdf · table 1" })).toBeChecked()
  })

  it("says so when the request throws rather than refusing, and lets you go again", async () => {
    // A refusal is an answer and carries its conflicts. A thrown request has
    // neither, and used to leave the button on "Combining…" for good.
    const onMerge = vi.fn().mockRejectedValue(
      new ApiError({ class: "not_implemented", message: "No endpoint yet." }, 501, null),
    )
    const { user } = render(
      <MergePicker
        overview={overview([INVOICES, LONE_LINES])}
        onMerge={onMerge}
        onUndo={noop}
        onMerged={merged}
      />,
    )
    await user.click(
      screen.getByRole("checkbox", { name: /Select all 2 tables with the Invoice totals shape/ }),
    )
    await user.click(screen.getByRole("button", { name: /Combine 2 tables/ }))

    expect(await screen.findByText("No endpoint yet.")).toBeVisible()
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Combine 2 tables/ })).toBeEnabled(),
    )
  })

  it("says so when every table in the batch has a shape of its own", () => {
    const lone = { ...LONE_LINES, shapeHash: "aaaa", name: "Something else" }
    render(
      <MergePicker
        overview={overview([lone, LONE_LINES])}
        onMerge={vi.fn()}
        onUndo={noop}
        onMerged={merged}
      />,
    )
    expect(screen.getByText("No two tables in this batch share a shape")).toBeVisible()
  })

  it("lists the merges already made, and can undo one", async () => {
    const onUndo = vi.fn().mockResolvedValue(undefined)
    const { user } = render(
      <MergePicker
        overview={overview(
          [LONE_LINES],
          [
            {
              mergeId: "mrg_1",
              name: "August invoices",
              rowCount: 28,
              tableCount: 2,
              shapeHash: "9c1f",
            },
          ],
        )}
        onMerge={vi.fn()}
        onUndo={onUndo}
        onMerged={merged}
      />,
    )
    expect(screen.getByText("August invoices")).toBeVisible()
    expect(screen.getByText("2 tables · 28 rows")).toBeVisible()

    await user.click(screen.getByRole("button", { name: /Undo/ }))
    expect(onUndo).toHaveBeenCalledWith("mrg_1")
  })
})
