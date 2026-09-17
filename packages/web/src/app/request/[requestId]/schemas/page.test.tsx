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

function mockBackend(entries: SchemaEntry[]) {
  const saved: { schemaId: string; fields: SchemaField[] }[][] = []
  server.use(
    http.post("/api/register", () => HttpResponse.json({ status: "ok" })),
    http.post("/api/polling/schema", () =>
      HttpResponse.json({
        userId: "usr_1",
        requestId: REQUEST,
        pending: 0,
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

async function renderReview() {
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
  it("stands a skeleton in the screen's place rather than counting to zero", async () => {
    server.use(
      http.post("/api/register", () => HttpResponse.json({ status: "ok" })),
      http.post("/api/polling/schema", async () => {
        await delay("infinite")
        return HttpResponse.json({})
      }),
    )
    await renderReview()

    expect(
      await screen.findByRole("status", { name: "Loading the schemas in this batch" }),
    ).toBeVisible()
    // Not "0 schemas to review", and not an empty state either — neither of
    // those is true yet, and both would be replaced a moment later.
    expect(screen.queryByText(/schemas? to review/)).not.toBeInTheDocument()
    expect(screen.queryByText("No schema came back")).not.toBeInTheDocument()
  })

  it("shows one card per schema, not one per file", async () => {
    mockBackend([entry(1, INVOICE), entry(2, INVOICE), entry(3, INVOICE), entry(4, CREDIT)])
    await renderReview()

    expect(await screen.findByText("2 schemas to review")).toBeVisible()
    expect(screen.getByText("4 tables · 4 files")).toBeVisible()

    const listed = cards()
    expect(listed).toHaveLength(2)
    // Biggest group first, and the count is of tables rather than of files.
    expect(within(listed[0]).getByText("3 tables")).toBeVisible()
  })

  it("names the files behind a card, and counts the ones it does not name", async () => {
    mockBackend([entry(1, INVOICE), entry(2, INVOICE), entry(3, INVOICE)])
    await renderReview()
    await screen.findByText("1 schema to review")

    expect(screen.getByText("invoice-101.pdf")).toBeVisible()
    expect(screen.getByText("invoice-102.pdf")).toBeVisible()
    expect(screen.getByText("and 1 more")).toBeVisible()
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
    const saved = mockBackend([entry(1, INVOICE), entry(2, INVOICE), entry(3, CREDIT)])
    const { user } = await renderReview()
    await screen.findByText("2 schemas to review")

    const panel = screen.getByRole("complementary", { name: "Schema" })
    await user.click(within(panel).getByRole("button", { name: "Update matching tables" }))
    await user.click(screen.getByRole("menuitem", { name: /Update all matching tables/ }))
    await user.click(screen.getByRole("button", { name: "Update 1 table" }))

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

    // Mid-edit, the wide write is shut and the narrow one is open.
    expect(within(panel).getByRole("button", { name: /Update matching tables/ })).toBeDisabled()
    await user.click(within(panel).getByRole("button", { name: "Save" }))

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
    expect(within(panel).getByText("from invoice-101.pdf · table 1")).toBeVisible()
    expect(within(panel).getByRole("button", { name: /Saved/ })).toBeVisible()
  })
})
