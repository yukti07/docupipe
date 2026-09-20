import { delay, http, HttpResponse } from "msw"
import { Suspense } from "react"
import { describe, expect, it, vi } from "vitest"
import { act, render, screen, waitFor, within } from "@/test/render"
import { server } from "@/test/msw/server"
import type { SchemaEntry, SchemaField } from "@/lib/api/types"
import { WorkspaceProvider } from "@/state/workspace"
import ReviewSchemasPage from "./page"

const router = { push: vi.fn(), replace: vi.fn() }
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}))

const REQUEST = "req_test"

const f = (key: string, type: SchemaField["type"]): SchemaField => ({
  key,
  label: key,
  type,
  origin: "detected",
})

const INVOICE = [f("invoice_number", "text"), f("total", "number")]
const CREDIT = [f("credit_note", "text"), f("amount", "number")]

const entry = (
  n: number,
  fields: SchemaField[],
  over: Partial<SchemaEntry["schema"]> = {},
): SchemaEntry => ({
  fileId: `file_${n}`,
  fileName: `invoice-10${n}.pdf`,
  filePath: `requests/${REQUEST}/input/invoice-10${n}.pdf`,
  schemaId: `sch_${n}`,
  status: "ready",
  schema: {
    tableOrd: 0,
    tableLabel: "table 1",
    version: 1,
    shapeHash: "9c1f",
    matchingFileCount: 1,
    fields,
    ...over,
  },
})

function mockBackend(entries: SchemaEntry[], { pending = 0 } = {}) {
  const saved: { schemaId: string; fields: SchemaField[] }[][] = []
  server.use(
    http.post("/api/register", () => HttpResponse.json({ status: "ok" })),
    http.post("/api/polling/schema", () =>
      HttpResponse.json({
        userId: "usr_1",
        requestId: REQUEST,
        pending,
        convertAvailable: true,
        convertBlockedReason: null,
        files: entries,
      }),
    ),
    http.post("/api/updateSchema", async ({ request }) => {
      const body = (await request.json()) as {
        files: { schemaId: string; schema: { fields: SchemaField[] } }[]
      }
      saved.push(body.files.map((file) => ({ schemaId: file.schemaId, fields: file.schema.fields })))
      return HttpResponse.json({
        status: "ok",
        updated: body.files.map((file) => ({ schemaId: file.schemaId, version: 2 })),
      })
    }),
    http.post("/api/convert", () => HttpResponse.json({ status: "received", queued: 1, skipped: 0 })),
  )
  return saved
}

async function renderReview(phase?: string) {
  if (phase) {
    localStorage.setItem(
      "quarry.workspace",
      JSON.stringify([
        {
          requestId: REQUEST,
          name: "Q3 invoices",
          createdAt: "2026-09-14T10:00:00Z",
          fileCount: 2,
          phase,
          summary: {},
        },
      ]),
    )
  }
  const params = Promise.resolve({ requestId: REQUEST })
  const searchParams = Promise.resolve({})
  let rendered!: ReturnType<typeof render>
  // Same reason as the batch screen's own test: use() suspends, and React only
  // retries the component once the synchronous act is awaited.
  await act(async () => {
    rendered = render(
      <WorkspaceProvider>
        <Suspense fallback={<p>loading</p>}>
          <ReviewSchemasPage params={params} searchParams={searchParams} />
        </Suspense>
      </WorkspaceProvider>,
    )
  })
  return rendered
}

/** The cards, in the order the screen lists them. */
const cards = () =>
  screen
    .getAllByRole("button", { name: /Edit this schema|is open in the panel/ })
    .map((button) => button.closest("section")!)

describe("Review schemas", () => {
  it("says what it is doing rather than counting to zero", async () => {
    server.use(
      http.post("/api/register", () => HttpResponse.json({ status: "ok" })),
      http.post("/api/polling/schema", async () => {
        await delay("infinite")
        return HttpResponse.json({})
      }),
    )
    await renderReview()

    expect(await screen.findByText("Detecting schemas")).toBeVisible()
    // Not "0 schemas to review", and not an empty state either — neither of
    // those is true yet, and both would be replaced a moment later.
    expect(screen.queryByText(/schemas? to review/)).not.toBeInTheDocument()
    expect(screen.queryByText("No schema came back")).not.toBeInTheDocument()
  })

  // A link to a batch this browser never held has no names to put on cards,
  // only the server's count — and a count is not worth two hundred skeletons.
  it("stands a few cards in for however many files it cannot name", async () => {
    mockBackend([], { pending: 200 })
    await renderReview()

    expect(await screen.findByText("and 197 more files being read")).toBeVisible()
    expect(screen.getAllByText("Detecting")).toHaveLength(3)
  })

  // The screen opens on what it has. Six files with two shapes back is two
  // cards and four names, not a full-page skeleton until the sixth lands.
  it("shows the shapes that are back beside a card for each file still reading", async () => {
    localStorage.setItem(
      `quarry.batch.${REQUEST}.files`,
      JSON.stringify(
        ["invoice-101.pdf", "invoice-102.pdf", "scan-0091.pdf"].map((fileName, i) => ({
          fileId: `file_${i + 1}`,
          fileName,
          fileLocation: fileName,
          size: 2048,
          filePath: "https://storage.example.test/0",
          expiresAt: "2026-09-14T11:05:00Z",
        })),
      ),
    )
    mockBackend([entry(1, INVOICE)], { pending: 2 })
    await renderReview()

    // The one that is back is a real card, with its fields on it.
    expect(await screen.findByText("1 schema to review")).toBeVisible()
    expect(cards()).toHaveLength(1)
    expect(within(cards()[0]).getByText(/invoice_number/)).toBeVisible()
    // The two that are not are named, and say so.
    expect(screen.getAllByText("Detecting")).toHaveLength(2)
    expect(screen.getByText("scan-0091.pdf")).toBeVisible()
  })

  it("shows one card per schema, not one per file", async () => {
    mockBackend([entry(1, INVOICE), entry(2, INVOICE), entry(3, INVOICE), entry(4, CREDIT)])
    await renderReview()

    expect(await screen.findByText("2 schemas to review")).toBeVisible()
    // The counts moved to the footer, beside the button they describe.
    expect(screen.getByText("2 schemas · 4 tables · 4 files")).toBeVisible()

    const listed = cards()
    expect(listed).toHaveLength(2)
    // Biggest group first, and the count is of tables rather than of files.
    expect(within(listed[0]).getByText("3 tables")).toBeVisible()
  })

  it("names the files behind a card, and counts the ones it does not name", async () => {
    mockBackend([entry(1, INVOICE), entry(2, INVOICE), entry(3, INVOICE)])
    await renderReview()
    await screen.findByText("1 schema to review")

    // Scoped to the card: the panel's own table dropdown names one of these
    // files too, and it is answering a different question.
    const card = cards()[0]
    expect(within(card).getByText("invoice-101.pdf")).toBeVisible()
    expect(within(card).getByText("invoice-102.pdf")).toBeVisible()
    expect(within(card).getByText("1 more")).toBeVisible()
  })

  it("opens the rest of the files from the count that stood for them", async () => {
    mockBackend([entry(1, INVOICE), entry(2, INVOICE), entry(3, INVOICE), entry(4, INVOICE)])
    const { user } = await renderReview()
    await screen.findByText("1 schema to review")

    expect(screen.queryByText("invoice-103.pdf")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "2 more" }))

    // Every file, and each one reachable — the count used to be a dead label,
    // so the only way to a named file's table was its own row on Files.
    expect(screen.getByText("invoice-103.pdf")).toBeVisible()
    expect(screen.getByText("invoice-104.pdf")).toBeVisible()
    expect(screen.queryByText(/^\d+ more$/)).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Edit the schema for invoice-104.pdf" }),
    ).toBeVisible()
  })

  it("says which of the three states every group is in", async () => {
    const saved = entry(2, [f("invoice_number", "text"), f("total", "currency")], { version: 2 })
    mockBackend([entry(1, INVOICE), saved])
    const { user } = await renderReview()
    await screen.findByText("2 schemas to review")

    const listed = cards()
    expect(within(listed[0]).getByText("Generated")).toBeVisible()
    expect(within(listed[1]).getByText("Modified")).toBeVisible()

    // The third state lives in the open editor, not in anything the server
    // holds, so the card behind it has to be told.
    const panel = screen.getByRole("complementary", { name: "Schema" })
    await user.click(within(panel).getByRole("combobox", { name: "Type of total" }))
    await user.click(screen.getByRole("option", { name: "currency" }))
    expect(within(cards()[0]).getByText("Unsaved changes")).toBeVisible()

    // And it leaves with the panel it belonged to.
    await user.click(within(panel).getByRole("button", { name: "Close the schema panel" }))
    expect(within(cards()[0]).getByText("Generated")).toBeVisible()
  })

  it("marks the open group on the card, and leaves its pencil alone", async () => {
    mockBackend([entry(1, INVOICE), entry(2, CREDIT)])
    await renderReview()
    await screen.findByText("2 schemas to review")

    const [open, other] = cards()
    // No word on either button: which one is open is the card's job to say.
    const openButton = within(open).getByRole("button", {
      name: "This schema is open in the panel",
    })
    expect(openButton).toBeDisabled()
    expect(openButton).toHaveTextContent("")
    expect(within(other).getByRole("button", { name: "Edit this schema" })).toBeEnabled()
  })

  it("applies to every table with this schema, and to nothing else", async () => {
    // Version 2: this shape has been saved over once, which is the only state
    // in which there is anything to push onto the tables beside it.
    const saved = mockBackend([
      entry(1, INVOICE, { version: 2 }),
      entry(2, INVOICE),
      entry(3, CREDIT),
    ])
    const { user } = await renderReview()
    await screen.findByText("2 schemas to review")

    const panel = screen.getByRole("complementary", { name: "Schema" })
    await user.click(within(panel).getByRole("button", { name: "Update All" }))
    await user.click(screen.getByRole("menuitem", { name: /Update all matching tables/ }))
    await user.click(screen.getByRole("button", { name: "Update 2 tables" }))

    await waitFor(() => expect(saved).toHaveLength(1))
    // The two invoices, never the credit note that only looks similar.
    expect(saved[0].map((s) => s.schemaId).sort()).toEqual(["sch_1", "sch_2"])
  })

  it("splits a table out of its group once it is saved on its own", async () => {
    // Already edited elsewhere — the shape it has now is the one that groups it.
    const edited = entry(2, [f("invoice_number", "text"), f("total", "currency")], { version: 2 })
    mockBackend([entry(1, INVOICE), edited, entry(3, INVOICE)])
    await renderReview()

    expect(await screen.findByText("2 schemas to review")).toBeVisible()
    const listed = cards()
    expect(within(listed[0]).getByText("2 tables")).toBeVisible()
    expect(within(listed[1]).getByText(/1 table/)).toBeVisible()
    expect(within(listed[1]).getByText("Modified")).toBeVisible()
  })

  it("edits one table at a time, but offers the whole group to apply to", async () => {
    const saved = mockBackend([entry(1, INVOICE), entry(2, INVOICE), entry(3, INVOICE)])
    const { user } = await renderReview()
    await screen.findByText("1 schema to review")

    const panel = screen.getByRole("complementary", { name: "Schema" })
    expect(within(panel).getByText("Schema of 3 tables")).toBeVisible()

    await user.click(within(panel).getByRole("combobox", { name: "Type of total" }))
    await user.click(screen.getByRole("option", { name: "currency" }))
    // A currency column has to say which currency before anything can be
    // saved — the second control is part of the one edit, not a follow-up.
    await user.click(within(panel).getByRole("combobox", { name: "Currency of total" }))
    await user.click(screen.getByRole("option", { name: "USD" }))

    // Mid-edit both are open: Update writes this table, Update All writes it
    // and the tables chosen beside it, in one write.
    expect(within(panel).getByRole("button", { name: /Update All/ })).toBeEnabled()
    await user.click(within(panel).getByRole("button", { name: "Update" }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toHaveLength(1)
    expect(saved[0][0].schemaId).toBe("sch_1")
    expect(saved[0][0].fields.find((x) => x.key === "total")?.type).toBe("currency")

    // And that table is now its own card, with the other two left together.
    await waitFor(() => expect(screen.getByText("2 schemas to review")).toBeVisible())

    // The panel stays on the table that was saved. Re-grouping puts the two
    // untouched invoices first, and a panel that followed the list would land
    // on one of them — throwing away the confirmation for the edit just made.
    expect(within(panel).getByText("Schema of 1 table")).toBeVisible()
    // The file, and not the sheet inside it: this file gave up one table, so
    // naming it again would only say "invoice-101.pdf · table 1".
    expect(within(panel).getByText("from invoice-101.pdf")).toBeVisible()
    expect(within(panel).getByRole("button", { name: /^Updated/ })).toBeVisible()
  })

  it("names the worksheet in the panel only when the file gave up more than one", async () => {
    // One workbook, two sheets: the file name alone would name both of them.
    const sheet = (n: number, label: string): SchemaEntry => ({
      ...entry(n, INVOICE, { tableLabel: label, shapeHash: `h${n}` }),
      fileId: "file_wb",
      fileName: "bank_statement.xlsx",
    })
    mockBackend([sheet(1, "Transactions"), sheet(2, "Account Summary")])
    await renderReview()
    // Both sheets read the same way, so they are one card — and the panel
    // still has to say which of the two it is on.
    await screen.findByText("1 schema to review")

    // Two tables in the group, so the panel names the one it picked in a
    // dropdown rather than in a caption — and names it with its sheet.
    const panel = screen.getByRole("complementary", { name: "Schema" })
    const picker = within(panel).getByRole("combobox", { name: "Table being edited" })
    expect(picker).toHaveTextContent("bank_statement.xlsx · Transactions")
  })

  it("moves the panel to another table in the group, edit and all", async () => {
    const sheet = (n: number, label: string): SchemaEntry => ({
      ...entry(n, INVOICE, { tableLabel: label }),
      fileId: "file_wb",
      fileName: "bank_statement.xlsx",
    })
    const saved = mockBackend([sheet(1, "Transactions"), sheet(2, "Account Summary")])
    const { user } = await renderReview()
    await screen.findByText("1 schema to review")

    const panel = screen.getByRole("complementary", { name: "Schema" })
    await user.click(within(panel).getByRole("combobox", { name: "Type of total" }))
    await user.click(screen.getByRole("option", { name: "date" }))

    // The two sheets share a shape, so the change fits either of them — and
    // picking which one to write to must not cost the change being written.
    await user.click(within(panel).getByRole("combobox", { name: "Table being edited" }))
    await user.click(screen.getByRole("option", { name: /Account Summary/ }))

    expect(within(panel).getByRole("combobox", { name: "Type of total" })).toHaveTextContent("date")
    await user.click(within(panel).getByRole("button", { name: "Update" }))

    await waitFor(() => expect(saved).toHaveLength(1))
    // The second sheet, and only it.
    expect(saved[0].map((s) => s.schemaId)).toEqual(["sch_2"])
    expect(saved[0][0].fields.find((x) => x.key === "total")?.type).toBe("date")
  })

  it("marks the field that changed on the card, once the change is saved", async () => {
    mockBackend([entry(1, INVOICE)])
    const { user } = await renderReview()
    await screen.findByText("1 schema to review")

    const panel = screen.getByRole("complementary", { name: "Schema" })
    // Before the edit the chip reads as detected: the muted fill every other
    // field on the card has.
    const chipFor = (key: string) =>
      [...cards()[0].querySelectorAll("li")].find((li) => li.textContent?.startsWith(`${key} ·`))!
    expect(chipFor("total").className).toContain("bg-muted")

    await user.click(within(panel).getByRole("combobox", { name: "Type of total" }))
    await user.click(screen.getByRole("option", { name: "currency" }))
    await user.click(within(panel).getByRole("combobox", { name: "Currency of total" }))
    await user.click(screen.getByRole("option", { name: "USD" }))
    await user.click(within(panel).getByRole("button", { name: "Update" }))

    // The badge says the schema was changed; the chip says which field. A
    // saved schema of thirty fields otherwise reads "Modified" and leaves the
    // reader to hunt for the one that moved.
    await waitFor(() => expect(chipFor("total").className).toContain("bg-primary-tint"))
    expect(chipFor("total")).toHaveTextContent("total · currency")
    expect(chipFor("invoice_number").className).toContain("bg-muted")
  })
})

describe("the schemas a converted batch was read against", () => {
  it("shows them, and says they are a record rather than a form", async () => {
    mockBackend([entry(1, INVOICE)])
    await renderReview("done")

    expect(await screen.findByText("1 schema to review")).toBeVisible()
    expect(screen.getByText(/has been converted/)).toBeVisible()
  })

  it("opens its cards with an eye rather than a pencil", async () => {
    mockBackend([entry(1, INVOICE), entry(2, CREDIT)])
    await renderReview("done")
    await screen.findByText("2 schemas to review")

    // A pencil on a screen where nothing can be changed is an offer the
    // screen cannot keep. The open one keeps saying it is the open one.
    expect(screen.getByRole("button", { name: "View this schema" })).toBeVisible()
    expect(screen.queryByRole("button", { name: "Edit this schema" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "This schema is open in the panel" })).toBeVisible()
  })

  it("takes no edits, and offers no second conversion", async () => {
    mockBackend([entry(1, INVOICE)])
    await renderReview("done")
    await screen.findByText("1 schema to review")

    const panel = screen.getByRole("complementary", { name: "Schema" })
    // The fields stay readable — they are what the batch was read against —
    // but every way of changing one is shut.
    expect(within(panel).getByText("invoice_number")).toBeVisible()
    expect(within(panel).getByRole("combobox", { name: "Type of invoice_number" })).toBeDisabled()
    expect(within(panel).queryByRole("button", { name: "Update" })).not.toBeInTheDocument()
    expect(within(panel).queryByRole("button", { name: /Add field/ })).not.toBeInTheDocument()
    expect(within(panel).getByText(/Schemas freeze at Convert/)).toBeVisible()
    expect(screen.queryByRole("button", { name: /^Convert/ })).not.toBeInTheDocument()
  })

  // Every file failed detection, so there is nothing to review and nothing
  // still on its way. The heading used to say "Detecting schemas" over a
  // card saying nothing came back, on a batch that had already converted.
  it("stops saying it is reading once the reading is over", async () => {
    mockBackend([
      {
        fileId: "file_1",
        fileName: "invoice-101.pdf",
        filePath: `requests/${REQUEST}/input/invoice-101.pdf`,
        schemaId: null,
        status: "failed",
        schema: null,
        failure: { class: "schema_inference_failed" },
      },
    ])
    await renderReview("done")

    expect(await screen.findByText("No schema came back")).toBeVisible()
    expect(screen.getByText("Nothing to review")).toBeVisible()
    expect(screen.queryByText("Detecting schemas")).not.toBeInTheDocument()
  })

  it("offers the way back to the results instead", async () => {
    mockBackend([entry(1, INVOICE)])
    await renderReview("done")
    await screen.findByText("1 schema to review")

    expect(screen.getByRole("link", { name: "Go to results" })).toHaveAttribute(
      "href",
      `/request/${REQUEST}`,
    )
  })

  it("is an ordinary editable screen before the gate", async () => {
    mockBackend([entry(1, INVOICE)])
    await renderReview("prepare")
    await screen.findByText("1 schema to review")

    expect(screen.getByRole("button", { name: /^Convert/ })).toBeVisible()
    expect(screen.queryByText(/has been converted/)).not.toBeInTheDocument()
  })
})
