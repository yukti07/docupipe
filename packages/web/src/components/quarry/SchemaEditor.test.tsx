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

/**
 * A schema that has already been saved over once, which is the only state in
 * which pushing it onto other tables means anything: untouched, it is the
 * shape every matching table already has.
 */
const edited = (over: Partial<SchemaState> = {}) => schema({ version: 2, ...over })

/**
 * Making a column a currency column, in full.
 *
 * Two answers, not one. The code is required, so the type change alone leaves
 * the editor in a state it will not save — which is the point of the second
 * control, and the reason every test that saves a currency edit does this.
 */
async function markCurrency(
  user: { click: (el: Element) => Promise<void> },
  key = "total",
  code = "USD",
) {
  await user.click(screen.getByRole("combobox", { name: `Type of ${key}` }))
  await user.click(screen.getByRole("option", { name: "currency" }))
  await user.click(screen.getByRole("combobox", { name: `Currency of ${key}` }))
  await user.click(screen.getByRole("option", { name: code }))
}

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

  it("puts a second control beside a currency field, and only beside one", () => {
    const { rerender } = render(
      <SchemaFieldRow
        field={f("total", "currency")}
        currencyColumn
        onChangeType={vi.fn()}
        onChangeCurrency={vi.fn()}
      />,
    )
    expect(screen.getAllByRole("combobox").map((c) => c.getAttribute("aria-label"))).toEqual([
      "Type of total",
      "Currency of total",
    ])

    rerender(
      <SchemaFieldRow
        field={f("invoice_number", "text")}
        currencyColumn
        onChangeType={vi.fn()}
        onChangeCurrency={vi.fn()}
      />,
    )
    expect(screen.getAllByRole("combobox")).toHaveLength(1)
  })

  it("shows a currency column with no code as unanswered, not as blank chrome", () => {
    render(
      <SchemaFieldRow
        field={f("total", "currency")}
        currencyColumn
        onChangeType={vi.fn()}
        onChangeCurrency={vi.fn()}
      />,
    )
    const control = screen.getByRole("combobox", { name: "Currency of total" })
    // A code, in the shape an answer takes, rather than the word "currency".
    // It is only a placeholder — which is what aria-invalid says, and what
    // stops it reading as a USD somebody chose.
    expect(control).toHaveTextContent("USD")
    expect(control).toHaveAttribute("aria-invalid", "true")
  })

  it("takes a code and stops reading as unanswered", async () => {
    const onChangeCurrency = vi.fn()
    const { user } = render(
      <SchemaFieldRow
        field={f("total", "currency")}
        currencyColumn
        onChangeType={vi.fn()}
        onChangeCurrency={onChangeCurrency}
      />,
    )
    await user.click(screen.getByRole("combobox", { name: "Currency of total" }))
    await user.click(screen.getByRole("option", { name: "EUR" }))
    expect(onChangeCurrency).toHaveBeenCalledWith("EUR")

    // There is no way back to unanswered: the code is required, so the list
    // offers the five and nothing else.
    await user.click(screen.getByRole("combobox", { name: "Currency of total" }))
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "USD",
      "EUR",
      "GBP",
      "INR",
      "JPY",
    ])
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
      screen.getByRole("button", { name: /Update — Nothing changed yet/ }),
    ).toBeDisabled()
    // The reason stays in the accessible name and off the screen: a line of
    // prose under an untouched form is noise on every schema anyone opens.
    expect(screen.queryByText(/Nothing changed yet/)).not.toBeInTheDocument()
  })

  it("offers neither write on a schema nobody has changed", () => {
    render(
      <SchemaEditor
        schema={schema()}
        fileName="invoice-1045.pdf"
        updateTargets={[target({ schemaId: "sch_32", fileName: "invoice-1046.pdf" })]}
        onSave={ok}
      />,
    )
    // Untouched, this is the shape the document gave — and every table it
    // would reach already has it. The write is a no-op dressed as a decision.
    expect(
      screen.getByRole("button", { name: "Update All — Nothing has changed to push" }),
    ).toBeDisabled()
    expect(screen.getByRole("button", { name: /^Update —/ })).toBeDisabled()
  })

  it("opens both writes the moment something changes", async () => {
    const { user } = render(
      <SchemaEditor
        schema={edited()}
        fileName="invoice-1045.pdf"
        updateTargets={[target({ schemaId: "sch_32", fileName: "invoice-1046.pdf" })]}
        onSave={ok}
      />,
    )
    // Saved over once already: this schema says something the tables beside
    // it do not, so it can be spread — but there is nothing new to write here.
    expect(screen.getByRole("button", { name: "Update All" })).toBeEnabled()
    expect(screen.getByRole("button", { name: /^Update —/ })).toBeDisabled()

    await markCurrency(user)

    // The wide write is one write: it carries the change to this table and to
    // the ones chosen beside it, so it does not wait on the narrow one.
    expect(screen.getByRole("button", { name: "Update All" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Update" })).toBeEnabled()
  })

  it("will not save a currency column that does not say which currency", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true })
    const { user } = render(
      <SchemaEditor
        schema={edited()}
        fileName="invoice-1045.pdf"
        updateTargets={[target({ schemaId: "sch_32", fileName: "invoice-1046.pdf" })]}
        onSave={onSave}
      />,
    )
    await user.click(screen.getByRole("combobox", { name: "Type of total" }))
    await user.click(screen.getByRole("option", { name: "currency" }))

    // Both writes, not just Save: pushing a half-answered shape onto tables
    // nobody is looking at is the worse half of the same mistake.
    expect(screen.getByRole("button", { name: /Update — Choose a currency for total/ })).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Update All — Choose a currency for total" }),
    ).toBeDisabled()
    // Here the reason is on screen as well: it is the one state the footer
    // offers no way out of.
    expect(screen.getByText("Choose the currency total is in.")).toBeVisible()

    await user.click(screen.getByRole("combobox", { name: "Currency of total" }))
    await user.click(screen.getByRole("option", { name: "GBP" }))

    expect(screen.getByRole("button", { name: "Update" })).toBeEnabled()
    expect(screen.queryByText(/Choose the currency/)).not.toBeInTheDocument()
  })

  it("lets a long schema scroll instead of clipping its last fields", () => {
    const many = Array.from({ length: 30 }, (_, i) => f(`field_${i}`, "text"))
    const { container } = render(
      <SchemaEditor schema={schema({ original: many, current: many })} fileName="wide.xlsx" onSave={ok} />,
    )
    const scroller = container.querySelector(".overflow-auto")
    const card = scroller?.querySelector(".rounded-xl")

    expect(screen.getByText("field_29")).toBeInTheDocument()
    // The card must not be allowed to shrink. It is `overflow-hidden`, so a
    // flex item that may shrink will shrink to nothing and clip its own rows
    // — the column then never overflows, and never scrolls.
    expect(card?.className).toContain("shrink-0")
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
    await markCurrency(user)
    await user.click(screen.getByRole("button", { name: "Update" }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    const [fields, targets] = onSave.mock.calls[0]
    expect(fields.find((x: SchemaField) => x.key === "total").type).toBe("currency")
    expect(targets).toEqual([])
  })

  it("saves the currency a column was marked with", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true })
    const { user } = render(
      <SchemaEditor schema={schema()} fileName="invoice-1045.pdf" onSave={onSave} />,
    )
    // The second control only exists once the column holds amounts.
    expect(screen.queryByRole("combobox", { name: "Currency of total" })).not.toBeInTheDocument()

    await user.click(screen.getByRole("combobox", { name: "Type of total" }))
    await user.click(screen.getByRole("option", { name: "currency" }))
    await user.click(screen.getByRole("combobox", { name: "Currency of total" }))
    await user.click(screen.getByRole("option", { name: "EUR" }))
    await user.click(screen.getByRole("button", { name: "Update" }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    const [fields] = onSave.mock.calls[0]
    expect(fields.find((x: SchemaField) => x.key === "total").currency).toBe("EUR")
  })

  it("takes the currency back off a column that stops holding amounts", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true })
    const { user } = render(
      <SchemaEditor schema={schema()} fileName="invoice-1045.pdf" onSave={onSave} />,
    )
    await user.click(screen.getByRole("combobox", { name: "Type of total" }))
    await user.click(screen.getByRole("option", { name: "currency" }))
    await user.click(screen.getByRole("combobox", { name: "Currency of total" }))
    await user.click(screen.getByRole("option", { name: "EUR" }))

    // Changed its mind: the column is text after all, so the claim about its
    // amounts goes with them rather than sitting on a column of prose.
    await user.click(screen.getByRole("combobox", { name: "Type of total" }))
    await user.click(screen.getByRole("option", { name: "text" }))
    await user.click(screen.getByRole("button", { name: "Update" }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    const [fields] = onSave.mock.calls[0]
    expect(fields.find((x: SchemaField) => x.key === "total")).not.toHaveProperty("currency")
  })

  it("keeps the edit on screen when the save fails", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: false, failure: { class: "network" } })
    const { user } = render(
      <SchemaEditor schema={schema()} fileName="invoice-1045.pdf" onSave={onSave} />,
    )
    await markCurrency(user)
    await user.click(screen.getByRole("button", { name: "Update" }))

    expect(await screen.findByText(/Couldn't reach the server/)).toBeVisible()
    expect(screen.getByRole("combobox", { name: "Type of total" })).toHaveTextContent("currency")
    expect(screen.getByRole("button", { name: "Update" })).toBeEnabled()
  })

  it("shows no editing controls at all once schemas are frozen", () => {
    render(<SchemaEditor schema={schema()} fileName="invoice-1045.pdf" frozen onSave={ok} />)
    expect(screen.queryByRole("button", { name: "Update" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Add field/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Schemas freeze at Convert/)).toBeVisible()
  })

  it("keeps the count out of the button and inside the choice it opens", async () => {
    const { user } = render(
      <SchemaEditor
        schema={edited()}
        fileName="invoice-1045.pdf"
        updateTargets={[
          target({ schemaId: "sch_32", fileName: "invoice-1046.pdf" }),
          target({ schemaId: "sch_33", fileName: "invoice-1047.pdf" }, ["total"]),
        ]}
        onSave={ok}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Update All" }))

    expect(screen.getByText("Choose which of the 3 matching tables take this schema.")).toBeVisible()
    // The near-matches are named up front, because taking the lot is the one
    // option that never shows you what it is about to touch.
    expect(screen.getByText(/All at once\. 1 of them differ by a field\./)).toBeVisible()
  })

  it("writes onto every match when you take the lot", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true })
    const { user } = render(
      <SchemaEditor
        schema={edited()}
        fileName="invoice-1045.pdf"
        updateTargets={[
          target({ schemaId: "sch_32", fileName: "invoice-1046.pdf" }),
          target({ schemaId: "sch_33", fileName: "invoice-1047.pdf" }),
        ]}
        onSave={onSave}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Update All" }))
    expect(onSave).not.toHaveBeenCalled()

    await user.click(screen.getByRole("menuitem", { name: /Update all matching tables/ }))
    await user.click(screen.getByRole("button", { name: "Update 3 tables" }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(onSave.mock.calls[0][1]).toEqual(["sch_32", "sch_33"])
    expect(await screen.findByText("Updated this table and 2 others.")).toBeVisible()
  })

  it("lets you pick the tables by hand, and touches only the ones ticked", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true })
    const { user } = render(
      <SchemaEditor
        schema={edited()}
        fileName="invoice-1045.pdf"
        updateTargets={[
          target({ schemaId: "sch_32", fileName: "invoice-1046.pdf" }),
          target({ schemaId: "sch_33", fileName: "invoice-1047.pdf" }),
          target({ schemaId: "sch_34", fileName: "invoice-1048.pdf" }, ["total"]),
        ]}
        onSave={onSave}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Update All" }))
    await user.click(screen.getByRole("menuitem", { name: /Select tables/ }))

    expect(screen.getByText(/Exact same fields/)).toBeVisible()
    expect(screen.getByText(/One field differs/)).toBeVisible()
    // The field a near-match would gain is named before it can be ticked.
    expect(screen.getByText(/no total .* added empty/)).toBeVisible()

    await user.click(screen.getByRole("checkbox", { name: "invoice-1046.pdf" }))
    expect(screen.getByText("2 of 4 chosen")).toBeVisible()

    await user.click(screen.getByRole("button", { name: "Update 2 tables" }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(onSave.mock.calls[0][1]).toEqual(["sch_32"])
    expect(await screen.findByText("Updated this table and 1 other.")).toBeVisible()
  })

  it("keeps the selection on screen when the write fails", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: false, failure: { class: "network" } })
    const { user } = render(
      <SchemaEditor
        schema={edited()}
        fileName="invoice-1045.pdf"
        updateTargets={[target({ schemaId: "sch_32", fileName: "invoice-1046.pdf" })]}
        onSave={onSave}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Update All" }))
    await user.click(screen.getByRole("menuitem", { name: /Select tables/ }))
    await user.click(screen.getByRole("checkbox", { name: "invoice-1046.pdf" }))
    await user.click(screen.getByRole("button", { name: "Update 2 tables" }))

    expect(await screen.findByText(/reach the server/)).toBeVisible()
    expect(screen.getByText("2 of 2 chosen")).toBeVisible()
    expect(screen.getByRole("checkbox", { name: "invoice-1046.pdf" })).toBeChecked()
  })

  it("saves the edit first, then spreads it — one click each, never a toggle", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true })
    const { user } = render(
      <SchemaEditor
        schema={edited()}
        fileName="invoice-1045.pdf"
        updateTargets={[target({ schemaId: "sch_32", fileName: "invoice-1046.pdf" })]}
        onSave={onSave}
      />,
    )
    await markCurrency(user)
    await user.click(screen.getByRole("button", { name: "Update" }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(onSave.mock.calls[0][1]).toEqual([])
    // Save has nothing left to do, and the footer names what it committed.
    expect(await screen.findByText(/committed for this table/)).toBeVisible()
    expect(screen.getByRole("button", { name: /^Updated/ })).toBeDisabled()

    await user.click(await screen.findByRole("button", { name: "Update All" }))
    await user.click(screen.getByRole("menuitem", { name: /Update all matching tables/ }))
    await user.click(screen.getByRole("button", { name: "Update 2 tables" }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
    expect(onSave.mock.calls[1][1]).toEqual(["sch_32"])
    expect(await screen.findByText("Updated this table and 1 other.")).toBeVisible()
  })

  it("lists the table on screen among the ones it is about to write, ticked and fixed", async () => {
    const { user } = render(
      <SchemaEditor
        schema={edited()}
        fileName="invoice-1045.pdf"
        updateTargets={[target({ schemaId: "sch_32", fileName: "invoice-1046.pdf" })]}
        onSave={ok}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Update All" }))
    await user.click(screen.getByRole("menuitem", { name: /Select tables/ }))

    // It is not a choice — every write reaches it — so it is shown as already
    // decided rather than left off a list of everywhere this schema is going.
    const mine = screen.getByRole("checkbox", { name: "invoice-1045.pdf — always updated" })
    expect(mine).toBeChecked()
    expect(mine).toBeDisabled()
    expect(screen.getByText("This table")).toBeVisible()
    expect(screen.getByText("1 of 2 chosen")).toBeVisible()

    // And with nothing else ticked it still has something to write.
    expect(screen.getByRole("button", { name: "Update 1 table" })).toBeEnabled()
  })

  it("names the table on screen before taking the lot", async () => {
    const { user } = render(
      <SchemaEditor
        schema={edited()}
        fileName="invoice-1045.pdf"
        updateTargets={[target({ schemaId: "sch_32", fileName: "invoice-1046.pdf" })]}
        onSave={ok}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Update All" }))
    await user.click(screen.getByRole("menuitem", { name: /Update all matching tables/ }))

    expect(screen.getByText(/Write onto all 2 matching tables\?/)).toBeVisible()
    expect(screen.getByText("· this table")).toBeVisible()
  })

  it("says plainly when no other table has these fields", () => {
    render(<SchemaEditor schema={schema()} fileName="invoice-1045.pdf" onSave={ok} />)
    expect(screen.getByText("No other table has these fields.")).toBeVisible()
  })
})
