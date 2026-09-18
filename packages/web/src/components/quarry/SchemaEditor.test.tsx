import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@/test/render"
import type { SchemaField } from "@/lib/api/types"
import type { SchemaState, UpdateTarget } from "@/lib/schema"
import { AddFieldControl } from "./AddFieldControl"
import { SchemaEditor } from "./SchemaEditor"
import { SchemaFieldRow } from "./SchemaFieldRow"

const f = (key: string, type: SchemaField["type"], origin: SchemaField["origin"] = "detected"): SchemaField => ({
  key,
  label: key,
  type,
  origin,
})

const FIELDS = [f("invoice_number", "text"), f("invoice_date", "date"), f("total", "number")]

const schema = (over: Partial<SchemaState> = {}): SchemaState => ({
  fileId: "file_7a4",
  fileName: "invoice-1045.pdf",
  filePath: "requests/r/invoice-1045.pdf",
  schemaId: "sch_31",
  tableLabel: "table 1",
  version: 1,
  original: FIELDS,
  current: FIELDS,
  ...over,
})

/** A table this schema can be pushed onto, and the field it would gain, if any. */
const target = (over: Partial<SchemaState> = {}, added: string[] = []): UpdateTarget => ({
  schema: schema(over),
  added,
})

const ok = async () => ({ ok: true }) as const

describe("SchemaFieldRow", () => {
  it("renders the name as plainly non-editable — no input, no rename control", () => {
    const { container } = render(
      <SchemaFieldRow field={f("invoice_number", "text")} onChangeType={vi.fn()} />,
    )
    expect(container.querySelector("input")).toBeNull()
    expect(screen.queryByRole("button", { name: /rename|delete|remove/i })).not.toBeInTheDocument()
    expect(screen.getByText("invoice_number").className).toContain("font-mono")
  })

  it("makes the type control the one interactive thing on the row", () => {
    render(<SchemaFieldRow field={f("total", "number")} onChangeType={vi.fn()} />)
    const controls = screen.getAllByRole("combobox")
    expect(controls).toHaveLength(1)
    expect(controls[0]).toHaveAccessibleName("Type of total")
  })

  it("says when a field was added by you", () => {
    render(<SchemaFieldRow field={f("supplier", "text", "added")} onChangeType={vi.fn()} />)
    expect(screen.getByText("added by you")).toBeVisible()
  })

  it("says what a changed type used to be", () => {
    render(
      <SchemaFieldRow field={f("total", "currency")} originalType="number" onChangeType={vi.fn()} />,
    )
    expect(screen.getByText("was number")).toBeVisible()
  })
})

describe("AddFieldControl", () => {
  it("blocks an empty name and says why", async () => {
    const onAdd = vi.fn()
    const { user } = render(<AddFieldControl fields={FIELDS} onAdd={onAdd} />)
    await user.click(screen.getByRole("button", { name: /Add field/ }))
    await user.click(screen.getByRole("button", { name: "Add" }))
    expect(screen.getByText("Give the field a name.")).toBeVisible()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it("blocks a name that collides, and keeps what was typed", async () => {
    const { user } = render(<AddFieldControl fields={FIELDS} onAdd={vi.fn()} />)
    await user.click(screen.getByRole("button", { name: /Add field/ }))
    await user.type(screen.getByLabelText("New field name"), "invoice_number")
    await user.click(screen.getByRole("button", { name: "Add" }))
    expect(screen.getByText(/already has a field called invoice_number/)).toBeVisible()
    expect(screen.getByLabelText("New field name")).toHaveValue("invoice_number")
  })

  it("adds a valid field", async () => {
    const onAdd = vi.fn()
    const { user } = render(<AddFieldControl fields={FIELDS} onAdd={onAdd} />)
    await user.click(screen.getByRole("button", { name: /Add field/ }))
    await user.type(screen.getByLabelText("New field name"), "supplier")
    await user.click(screen.getByRole("button", { name: "Add" }))
    expect(onAdd).toHaveBeenCalledWith("supplier", "text")
  })
})

describe("SchemaEditor", () => {
  it("names the wait while a file's shape is still being read", () => {
    render(
      <SchemaEditor schema={null} fileName="invoice-1045.pdf" reading onSave={ok} />,
    )
    expect(screen.getByText("Reading invoice-1045.pdf")).toBeVisible()
  })

  it("is honest when nothing could be detected, and still lets you add fields", () => {
    render(
      <SchemaEditor
        schema={null}
        fileName="scan-0091.pdf"
        noShape={{ class: "schema_not_found" }}
        onSave={ok}
      />,
    )
    expect(screen.getByText(/Couldn't find a table in this one/)).toBeVisible()
    expect(screen.getByRole("button", { name: /Add field/ })).toBeVisible()
  })

  it("keeps Save shut until something actually changed, without printing why", () => {
    render(<SchemaEditor schema={schema()} fileName="invoice-1045.pdf" onSave={ok} />)
    expect(
      screen.getByRole("button", { name: /Save — Nothing changed yet/ }),
    ).toBeDisabled()
    // The reason stays in the accessible name and off the screen: a line of
    // prose under an untouched form is noise on every schema anyone opens.
    expect(screen.queryByText(/Nothing changed yet/)).not.toBeInTheDocument()
  })

  it("offers exactly one of Save and Update matching tables at a time", async () => {
    const { user } = render(
      <SchemaEditor
        schema={schema()}
        fileName="invoice-1045.pdf"
        updateTargets={[target({ schemaId: "sch_32", fileName: "invoice-1046.pdf" })]}
        onSave={ok}
      />,
    )
    // Nothing edited: this schema is what the server holds, so it can be spread.
    expect(screen.getByRole("button", { name: "Update matching tables" })).toBeEnabled()
    expect(screen.getByRole("button", { name: /^Save/ })).toBeDisabled()

    await user.click(screen.getByRole("combobox", { name: "Type of total" }))
    await user.click(screen.getByRole("option", { name: "currency" }))

    // Edited: pushing now would write a draft onto files nobody has looked at,
    // and the footer says so rather than leaving a dead button to puzzle over.
    expect(
      screen.getByRole("button", { name: "Update matching tables — save your change first" }),
    ).toBeDisabled()
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
    expect(screen.getByText("Save this schema before pushing it anywhere else.")).toBeVisible()
  })

  it("puts Add field under the columns, not among the commit buttons", () => {
    const { container } = render(
      <SchemaEditor schema={schema()} fileName="invoice-1045.pdf" onSave={ok} />,
    )
    const add = screen.getByRole("button", { name: /Add field/ })
    expect(add.closest("footer")).toBeNull()
    expect(add.className).toContain("border-dashed")
    // After the last field row it came from, in document order.
    const total = screen.getByText("total")
    expect(total.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelector("footer")).not.toBeNull()
  })

  it("saves a type change, and only this file when apply-to-all is off", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true })
    const { user } = render(
      <SchemaEditor schema={schema()} fileName="invoice-1045.pdf" onSave={onSave} />,
    )
    await user.click(screen.getByRole("combobox", { name: "Type of total" }))
    await user.click(screen.getByRole("option", { name: "currency" }))
    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    const [fields, targets] = onSave.mock.calls[0]
    expect(fields.find((x: SchemaField) => x.key === "total").type).toBe("currency")
    expect(targets).toEqual([])
  })

  it("keeps the edit on screen when the save fails", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: false, failure: { class: "network" } })
    const { user } = render(
      <SchemaEditor schema={schema()} fileName="invoice-1045.pdf" onSave={onSave} />,
    )
    await user.click(screen.getByRole("combobox", { name: "Type of total" }))
    await user.click(screen.getByRole("option", { name: "currency" }))
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByText(/Couldn't reach the server/)).toBeVisible()
    expect(screen.getByRole("combobox", { name: "Type of total" })).toHaveTextContent("currency")
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
  })

  it("shows no editing controls at all once schemas are frozen", () => {
    render(<SchemaEditor schema={schema()} fileName="invoice-1045.pdf" frozen onSave={ok} />)
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Add field/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Schemas freeze at Convert/)).toBeVisible()
  })

  it("keeps the count out of the button and inside the choice it opens", async () => {
    const { user } = render(
      <SchemaEditor
        schema={schema()}
        fileName="invoice-1045.pdf"
        updateTargets={[
          target({ schemaId: "sch_32", fileName: "invoice-1046.pdf" }),
          target({ schemaId: "sch_33", fileName: "invoice-1047.pdf" }, ["total"]),
        ]}
        onSave={ok}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Update matching tables" }))

    expect(screen.getByText("Choose which of the 2 matching tables take this schema.")).toBeVisible()
    // The near-matches are named up front, because taking the lot is the one
    // option that never shows you what it is about to touch.
    expect(screen.getByText(/All at once\. 1 of them differ by a field\./)).toBeVisible()
  })

  it("writes onto every match when you take the lot", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true })
    const { user } = render(
      <SchemaEditor
        schema={schema()}
        fileName="invoice-1045.pdf"
        updateTargets={[
          target({ schemaId: "sch_32", fileName: "invoice-1046.pdf" }),
          target({ schemaId: "sch_33", fileName: "invoice-1047.pdf" }),
        ]}
        onSave={onSave}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Update matching tables" }))
    expect(onSave).not.toHaveBeenCalled()

    await user.click(screen.getByRole("menuitem", { name: /Update all matching tables/ }))
    await user.click(screen.getByRole("button", { name: "Update 2 tables" }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(onSave.mock.calls[0][1]).toEqual(["sch_32", "sch_33"])
    expect(await screen.findByText("Updated 2 other tables.")).toBeVisible()
  })

  it("lets you pick the tables by hand, and touches only the ones ticked", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true })
    const { user } = render(
      <SchemaEditor
        schema={schema()}
        fileName="invoice-1045.pdf"
        updateTargets={[
          target({ schemaId: "sch_32", fileName: "invoice-1046.pdf" }),
          target({ schemaId: "sch_33", fileName: "invoice-1047.pdf" }),
          target({ schemaId: "sch_34", fileName: "invoice-1048.pdf" }, ["total"]),
        ]}
        onSave={onSave}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Update matching tables" }))
    await user.click(screen.getByRole("menuitem", { name: /Select tables/ }))

    expect(screen.getByText(/Exact same fields/)).toBeVisible()
    expect(screen.getByText(/One field differs/)).toBeVisible()
    // The field a near-match would gain is named before it can be ticked.
    expect(screen.getByText(/no total .* added empty/)).toBeVisible()

    await user.click(screen.getByRole("checkbox", { name: "invoice-1046.pdf" }))
    expect(screen.getByText("1 of 3 chosen")).toBeVisible()

    await user.click(screen.getByRole("button", { name: "Update 1 table" }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(onSave.mock.calls[0][1]).toEqual(["sch_32"])
    expect(await screen.findByText("Updated 1 other table.")).toBeVisible()
  })

  it("keeps the selection on screen when the write fails", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: false, failure: { class: "network" } })
    const { user } = render(
      <SchemaEditor
        schema={schema()}
        fileName="invoice-1045.pdf"
        updateTargets={[target({ schemaId: "sch_32", fileName: "invoice-1046.pdf" })]}
        onSave={onSave}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Update matching tables" }))
    await user.click(screen.getByRole("menuitem", { name: /Select tables/ }))
    await user.click(screen.getByRole("checkbox", { name: "invoice-1046.pdf" }))
    await user.click(screen.getByRole("button", { name: "Update 1 table" }))

    expect(await screen.findByText(/reach the server/)).toBeVisible()
    expect(screen.getByText("1 of 1 chosen")).toBeVisible()
    expect(screen.getByRole("checkbox", { name: "invoice-1046.pdf" })).toBeChecked()
  })

  it("saves the edit first, then spreads it — one click each, never a toggle", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true })
    const { user } = render(
      <SchemaEditor
        schema={schema()}
        fileName="invoice-1045.pdf"
        updateTargets={[target({ schemaId: "sch_32", fileName: "invoice-1046.pdf" })]}
        onSave={onSave}
      />,
    )
    await user.click(screen.getByRole("combobox", { name: "Type of total" }))
    await user.click(screen.getByRole("option", { name: "currency" }))
    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(onSave.mock.calls[0][1]).toEqual([])
    // Save has nothing left to do, and the footer names what it committed.
    expect(await screen.findByText(/committed for this table/)).toBeVisible()
    expect(screen.getByRole("button", { name: /Saved/ })).toBeDisabled()

    await user.click(await screen.findByRole("button", { name: "Update matching tables" }))
    await user.click(screen.getByRole("menuitem", { name: /Update all matching tables/ }))
    await user.click(screen.getByRole("button", { name: "Update 1 table" }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
    expect(onSave.mock.calls[1][1]).toEqual(["sch_32"])
    expect(await screen.findByText("Updated 1 other table.")).toBeVisible()
  })

  it("says plainly when no other table has these fields", () => {
    render(<SchemaEditor schema={schema()} fileName="invoice-1045.pdf" onSave={ok} />)
    expect(screen.getByText("No other table has these fields.")).toBeVisible()
  })
})
