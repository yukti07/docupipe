import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@/test/render"
import type { SchemaField } from "@/lib/api/types"
import type { SchemaState } from "@/lib/schema"
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

  it("keeps Save shut until something actually changed, and says why", () => {
    render(<SchemaEditor schema={schema()} fileName="invoice-1045.pdf" onSave={ok} />)
    expect(
      screen.getByRole("button", { name: /Save — Nothing changed yet/ }),
    ).toBeDisabled()
    expect(screen.getByText(/Nothing changed yet/)).toBeVisible()
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

  it("carries the count of matching files in the apply-to-all label", async () => {
    const targets = [schema({ schemaId: "sch_32", fileName: "invoice-1046.pdf" })]
    render(
      <SchemaEditor
        schema={schema()}
        fileName="invoice-1045.pdf"
        applyTargets={targets}
        onSave={ok}
      />,
    )
    expect(screen.getByRole("button", { name: "Apply to 1 file" })).toBeVisible()
  })

  it("names the affected files before it commits to them", async () => {
    const targets = [
      schema({ schemaId: "sch_32", fileName: "invoice-1046.pdf" }),
      schema({ schemaId: "sch_33", fileName: "invoice-1047.pdf" }),
    ]
    const onSave = vi.fn().mockResolvedValue({ ok: true })
    const { user } = render(
      <SchemaEditor
        schema={schema()}
        fileName="invoice-1045.pdf"
        applyTargets={targets}
        onSave={onSave}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Apply to 2 files" }))
    expect(screen.getByText("invoice-1046.pdf · table 1")).toBeVisible()
    expect(screen.getByText("invoice-1047.pdf · table 1")).toBeVisible()
    expect(onSave).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Include these 2" }))
    await user.click(screen.getByRole("combobox", { name: "Type of total" }))
    await user.click(screen.getByRole("option", { name: "currency" }))
    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(onSave.mock.calls[0][1]).toEqual(["sch_32", "sch_33"])
    expect(await screen.findByText("Saved to 3 files.")).toBeVisible()
  })

  it("says plainly when no other file started with this shape", () => {
    render(<SchemaEditor schema={schema()} fileName="invoice-1045.pdf" onSave={ok} />)
    expect(screen.getByText("No other file started with this shape.")).toBeVisible()
  })
})
