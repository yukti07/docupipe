import { http, HttpResponse } from "msw"
import { Suspense } from "react"
import { describe, expect, it, vi } from "vitest"
import { act, render, screen, waitFor, within } from "@/test/render"
import { server } from "@/test/msw/server"
import type { SchemaEntry } from "@/lib/api/types"
import { stageFiles } from "@/lib/preflight"
import { stageForRequest } from "@/state/staged"
import { WorkspaceProvider, type WorkspaceBatch } from "@/state/workspace"
import BatchPage from "./page"

const router = { push: vi.fn(), replace: vi.fn() }
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}))

const REQUEST = "req_test"
const PUT_URL = "https://storage.googleapis.com/quarry"

const file = (name: string) => new File(["x".repeat(32)], name)

const schemaEntry = (over: Partial<SchemaEntry> = {}): SchemaEntry => ({
  fileId: "file_1",
  fileName: "invoice-1043.pdf",
  filePath: "requests/req_test/input/invoice-1043.pdf",
  schemaId: "sch_31",
  status: "ready",
  schema: {
    tableOrd: 0,
    tableLabel: "table 1",
    version: 1,
    shapeHash: "9c1f",
    matchingFileCount: 2,
    fields: [
      { key: "invoice_number", label: "invoice_number", type: "text", origin: "detected" },
      { key: "total", label: "total", type: "number", origin: "detected" },
    ],
  },
  ...over,
})

type SchemaPollOptions = {
  entries?: SchemaEntry[]
  convertAvailable?: boolean
  convertBlockedReason?: string | null
  pending?: number
  /** What the result poll reports, which is how the screen learns its phase. */
  result?: Record<string, unknown>
}

function mockBackend({
  entries = [schemaEntry()],
  convertAvailable = true,
  convertBlockedReason = null,
  pending = 0,
  result,
}: SchemaPollOptions = {}) {
  const seen = {
    signed: 0,
    puts: [] as string[],
    confirmed: [] as unknown[],
    converts: 0,
    results: 0,
    schemaPolls: 0,
    uploadCalls: [] as number[],
  }

  server.use(
    http.post("/api/register", () => HttpResponse.json({ status: "ok" })),
    http.post("/api/getSignedUrl", async ({ request }) => {
      const body = (await request.json()) as { files: string[] }
      seen.signed += 1
      return HttpResponse.json({
        userId: "usr_1",
        requestId: REQUEST,
        files: body.files.map((fileName, index) => ({
          fileId: `file_${index + 1}`,
          fileName,
          filePath: `${PUT_URL}/${index}?X-Goog-Signature=abc`,
          uploadHeaders: { "Content-Type": "application/pdf" },
          expiresAt: "2026-09-14T11:05:00Z",
        })),
      })
    }),
    http.put(`${PUT_URL}/:n`, ({ params }) => {
      seen.puts.push(String(params.n))
      return new HttpResponse(null, { status: 200 })
    }),
    http.post("/api/upload", async ({ request }) => {
      const body = (await request.json()) as { files: { fileId: string }[] }
      seen.confirmed.push(...body.files)
      seen.uploadCalls.push(body.files.length)
      return HttpResponse.json({
        status: "ok",
        files: body.files.map((f) => ({ fileId: f.fileId, stage: "UPLOADED" })),
      })
    }),
    http.post("/api/polling/schema", () => {
      seen.schemaPolls += 1
      return HttpResponse.json({
        userId: "usr_1",
        requestId: REQUEST,
        pending,
        convertAvailable,
        convertBlockedReason,
        files: entries,
      })
    }),
    http.post("/api/updateSchema", async ({ request }) => {
      const body = (await request.json()) as { files: { schemaId: string }[] }
      return HttpResponse.json({
        status: "ok",
        updated: body.files.map((f) => ({ schemaId: f.schemaId, version: 2 })),
      })
    }),
    http.post("/api/convert", () => {
      seen.converts += 1
      return HttpResponse.json({ status: "received", queued: 1, skipped: 0 })
    }),
    // The probe that asks the server which phase this batch is in. Empty means
    // nothing has been queued for conversion yet.
    http.post("/api/polling/result", () => {
      seen.results += 1
      return HttpResponse.json(
        result ?? {
          userId: "usr_1",
          requestId: REQUEST,
          status: "CONVERTING",
          pausedUntil: null,
          counts: { queued: 0, extracting: 0, filling: 0, done: 0, failed: 0 },
          rowsSoFar: 0,
          estimatedSecondsRemaining: null,
          allowance: { used: 0, limit: 5000, resetsAt: "2026-09-15T00:00:00Z" },
          files: [],
        },
      )
    }),
  )

  return seen
}

async function renderBatch(
  phase?: WorkspaceBatch["phase"],
  query: Record<string, string> = {},
) {
  const params = Promise.resolve({ requestId: REQUEST })
  const searchParams = Promise.resolve(query)
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
  // The page reads its route params with use(). React only retries a component
  // that suspended during a *synchronous* act once that act is awaited, so the
  // render itself has to happen inside one.
  let rendered!: ReturnType<typeof render>
  await act(async () => {
    rendered = render(
      <WorkspaceProvider>
        <Suspense fallback={<p>loading</p>}>
          <BatchPage params={params} searchParams={searchParams} />
        </Suspense>
      </WorkspaceProvider>,
    )
  })
  return rendered
}

describe("the prepare screen", () => {
  it("signs, PUTs, then confirms — never marking a file uploaded off the signed url alone", async () => {
    const seen = mockBackend()
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf"), file("invoice-1044.pdf")]))
    await renderBatch()

    await waitFor(() => expect(seen.confirmed).toHaveLength(2))
    expect(seen.signed).toBe(1)
    expect(seen.puts.sort()).toEqual(["0", "1"])
  })

  it("confirms each file as its own bytes land, not once the last one does", async () => {
    const seen = mockBackend()
    stageForRequest(
      REQUEST,
      stageFiles([file("invoice-1043.pdf"), file("invoice-1044.pdf"), file("invoice-1045.pdf")]),
    )
    await renderBatch()

    await waitFor(() => expect(seen.confirmed).toHaveLength(3))
    // Three calls of one file each — so the first file's shape is being read
    // while the third is still going up.
    expect(seen.uploadCalls).toEqual([1, 1, 1])
  })

  it("counts the uploads on the footer, and nothing about the shapes", async () => {
    mockBackend()
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf"), file("invoice-1044.pdf")]))
    await renderBatch()

    expect(await screen.findByText("2 of 2 uploaded")).toBeVisible()
    // Neither button waits on the shapes, so a count of them was a number
    // nobody could act on.
    expect(screen.queryByText(/schemas back/)).not.toBeInTheDocument()
  })

  it("keeps a rejected file on screen with its reason, and uploads the rest", async () => {
    const seen = mockBackend()
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf"), file("q3-archive.zip")]))
    await renderBatch()

    expect(await screen.findByText(/unzip it first/i)).toBeVisible()
    await waitFor(() => expect(seen.confirmed).toHaveLength(1))
  })

  // A row is a record of the file — what it is, how it went up, what shapes it
  // gave back. Editing one is Review Schemas' job, over the whole batch at once.
  it("puts no schema control on a row, and opens Review Schemas anyway", async () => {
    mockBackend({
      entries: [],
      pending: 2,
      convertAvailable: false,
      convertBlockedReason: "2 files are still reading their shape.",
    })
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    await renderBatch()

    await screen.findByText("invoice-1043.pdf")
    expect(screen.queryByRole("button", { name: /schema/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("complementary", { name: "Schema" })).not.toBeInTheDocument()
    // Not one shape is back, and the way to review them is open regardless —
    // that screen shows a card per file it is still reading.
    expect(screen.getByRole("link", { name: "Review Schemas" })).toHaveAttribute(
      "href",
      `/request/${REQUEST}/schemas`,
    )
  })

  it("repeats the server's reason on the gate, and refuses to convert early", async () => {
    mockBackend({
      entries: [schemaEntry()],
      pending: 7,
      convertAvailable: false,
      convertBlockedReason: "7 files are still reading their shape.",
    })
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    await renderBatch()

    // The reason rides on the disabled button rather than being printed again
    // beside the counts the footer already carries.
    expect(
      await screen.findByRole("button", {
        name: /Convert.*7 files are still reading their shape/,
      }),
    ).toBeDisabled()
  })

  it("converts once the gate is met, and moves the batch on", async () => {
    const seen = mockBackend()
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    const { user } = await renderBatch("prepare")

    await user.click(await screen.findByRole("button", { name: /^Convert/ }))
    await waitFor(() => expect(seen.converts).toBe(1))
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("quarry.workspace")!)[0].phase).toBe("converting"),
    )
  })

  it("keeps a file with no table on the list rather than dropping it", async () => {
    mockBackend({
      entries: [
        {
          fileId: "file_1",
          fileName: "scan-0091.pdf",
          filePath: "x",
          schemaId: null,
          status: "failed",
          schema: null,
          failure: { class: "schema_not_found" },
        },
      ],
    })
    stageForRequest(REQUEST, stageFiles([file("scan-0091.pdf")]))
    await renderBatch()

    // It reads no shape, so it carries no shape line — and it is still a row,
    // because it is still a file that was dropped. Its name is on the row and
    // again in the panel of files that won't convert, which is where the
    // reason lives now that the row has no control to hang it on.
    expect((await screen.findAllByText("scan-0091.pdf")).length).toBeGreaterThan(0)
    expect(screen.getByText("Couldn't find a table in this one.")).toBeVisible()
  })

  it("names an unconvertible file and still lets the batch convert", async () => {
    mockBackend({
      entries: [
        schemaEntry(),
        {
          fileId: "file_2",
          fileName: "scan-0091.pdf",
          filePath: "requests/req_test/input/scan-0091.pdf",
          schemaId: null,
          status: "failed",
          schema: null,
          failure: { class: "extract_empty" },
        },
      ],
    })
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf"), file("scan-0091.pdf")]))
    await renderBatch()

    expect(await screen.findByText(/1 file won't convert/)).toBeVisible()
    expect(screen.getByText(/images with no readable text/)).toBeVisible()
    expect(screen.getByRole("button", { name: /^Convert/ })).toBeEnabled()
  })

  it("retries only the row whose Retry was pressed", async () => {
    const seen = mockBackend()
    let refused = false
    server.use(
      http.put(`${PUT_URL}/:n`, ({ params }) => {
        const which = String(params.n)
        seen.puts.push(which)
        if (which === "0" && !refused) {
          refused = true
          return new HttpResponse(null, { status: 500 })
        }
        return new HttpResponse(null, { status: 200 })
      }),
    )
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf"), file("invoice-1044.pdf")]))
    const { user } = await renderBatch()

    const retry = await screen.findByRole("button", { name: "Retry" })
    seen.puts.length = 0
    await user.click(retry)

    await waitFor(() => expect(seen.puts).toEqual(["0"]))
  })

  it("drops a batch whose every row was discarded, rather than leaving an empty card", async () => {
    mockBackend()
    server.use(http.put(`${PUT_URL}/:n`, () => new HttpResponse(null, { status: 500 })))
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    const { user } = await renderBatch("prepare")

    await user.click(await screen.findByRole("button", { name: "Discard them" }))

    await waitFor(() => expect(JSON.parse(localStorage.getItem("quarry.workspace")!)).toEqual([]))
    expect(router.push).toHaveBeenCalledWith("/")
  })

  it("leaves a failed row its Retry and nothing else to press", async () => {
    mockBackend()
    server.use(http.put(`${PUT_URL}/:n`, () => new HttpResponse(null, { status: 500 })))
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    await renderBatch()

    expect(await screen.findByText("Upload failed")).toBeVisible()
    const row = screen.getByText("invoice-1043.pdf").closest<HTMLElement>("[data-state]")!
    expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual(["Retry"])
  })

  it("names a worksheet that gave nothing, without failing the workbook", async () => {
    mockBackend({
      entries: [
        schemaEntry({ schemaId: "sch_1", schema: { ...schemaEntry().schema!, tableLabel: "Transactions" } }),
        schemaEntry({ schemaId: "sch_2", schema: { ...schemaEntry().schema!, tableLabel: "Account Summary" } }),
        schemaEntry({
          schemaId: "sch_3",
          status: "failed",
          schema: null,
          tableLabel: "Workings",
          failure: { class: "extract_empty", message: "This sheet has no columns." },
        }),
      ],
    })
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    await renderBatch()

    // The empty sheet is named beside the two that read, on the file's own row.
    expect(
      await screen.findByText(
        /Transactions · \d+ fields · Account Summary · \d+ fields · Workings · nothing usable/,
      ),
    ).toBeVisible()

    // The workbook converts, so it must not be listed as a file that won't.
    expect(screen.queryByText(/won't convert/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Convert/ })).toBeEnabled()
  })

  it("names every table a many-table file gave up, on the file's own row", async () => {
    mockBackend({
      entries: [
        schemaEntry({ schemaId: "sch_1", schema: { ...schemaEntry().schema!, tableLabel: "table 1" } }),
        schemaEntry({ schemaId: "sch_2", schema: { ...schemaEntry().schema!, tableLabel: "table 2" } }),
        schemaEntry({ schemaId: "sch_3", schema: { ...schemaEntry().schema!, tableLabel: "table 3" } }),
      ],
    })
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    await renderBatch()

    // Three tables, one row, each named with its own field count — counted
    // table by table, because a total would be a number nothing has.
    expect(
      await screen.findByText(
        /table 1 · \d+ fields · table 2 · \d+ fields · table 3 · \d+ fields/,
      ),
    ).toBeVisible()
  })

  it("shows the files that landed before a reload, without their bytes", async () => {
    mockBackend()
    localStorage.setItem(
      `quarry.batch.${REQUEST}.files`,
      JSON.stringify([
        {
          fileId: "file_1",
          fileName: "invoice-1043.pdf",
          fileLocation: "Q3 invoices/invoice-1043.pdf",
          size: 2048,
          filePath: "https://storage.example.test/0?X-Goog-Signature=abc",
          expiresAt: "2026-09-14T11:05:00Z",
        },
      ]),
    )
    await renderBatch()

    expect((await screen.findAllByText("invoice-1043.pdf")).length).toBeGreaterThan(0)
    expect(screen.queryByText("Nothing staged in this browser")).not.toBeInTheDocument()
    // Its shape was already being read on the server, so the poll settles it
    // and the row says which tables came back.
    expect(await screen.findByText(/fields/)).toBeVisible()
  })

  it("does not poll for schemas before the server has been told the request exists", async () => {
    const seen = mockBackend()
    // Signing is what creates the request row; until it answers there is
    // nothing on the other end and the poll can only 500.
    server.use(
      http.post("/api/getSignedUrl", () => HttpResponse.json({ error: "nope" }, { status: 500 })),
    )
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    await renderBatch()

    expect(await screen.findByText("Upload failed")).toBeVisible()
    expect(seen.schemaPolls).toBe(0)
  })

  it("does not ask the server which phase a batch it just staged is in", async () => {
    const seen = mockBackend()
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    await renderBatch("prepare")

    // The schema poll runs; the result poll has no business here until Convert.
    await waitFor(() => expect(seen.confirmed).toHaveLength(1))
    expect(seen.results).toBe(0)
  })

  it("moves straight onto the batch, with one wait rather than two", async () => {
    const seen = mockBackend({
      // What the server answers for a request queued a second ago: every table
      // listed, none of them started. `pollResult` reads them off the schemas,
      // so it can say this before the worker has touched anything.
      result: {
        userId: "usr_1",
        requestId: REQUEST,
        status: "CONVERTING",
        pausedUntil: null,
        counts: { queued: 2, extracting: 0, filling: 0, done: 0, failed: 0 },
        rowsSoFar: 0,
        estimatedSecondsRemaining: null,
        allowance: { used: 0, limit: 5000, resetsAt: "2026-09-15T00:00:00Z" },
        files: [
          { fileId: "file_1", fileName: "invoice-1043.pdf", schemaId: "sch_31", stage: "QUEUED" },
          { fileId: "file_2", fileName: "invoice-1044.pdf", schemaId: "sch_32", stage: "QUEUED" },
        ],
      },
    })
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    const { user } = await renderBatch("prepare")

    await user.click(await screen.findByRole("button", { name: /^Convert/ }))
    await waitFor(() => expect(seen.converts).toBe(1))

    // A screen with the batch on it, not a second full-page state behind the
    // button that was already saying Converting.
    expect(await screen.findByText(/0 of 2 done/)).toBeVisible()
    expect(screen.getByText("invoice-1043.pdf")).toBeVisible()
    expect(screen.getByText("invoice-1044.pdf")).toBeVisible()
    expect(screen.queryByText("Converting your files")).not.toBeInTheDocument()

    // The wait moves onto the rows: each one says what it is doing and spins
    // while it waits its turn. One word covers all of it — queued, extracting
    // and filling are the worker's business, not the reader's.
    expect(screen.getAllByText("Converting")).toHaveLength(2)
    expect(screen.queryByText("Waiting")).not.toBeInTheDocument()
    expect(screen.queryByText("Running")).not.toBeInTheDocument()

    // And then it eases off: the worker has minutes of work before any of those
    // stages change, and one poll has already said everything there is to say.
    expect(seen.results).toBe(1)
  })

  it("comes back to a batch on what it last knew, not on a fresh wait", async () => {
    // Pressing Back to the batch from a table remounts this screen. The answer
    // it is about to ask for is one it already has.
    localStorage.setItem(
      `quarry.cache.${REQUEST}.result`,
      JSON.stringify({
        userId: "usr_1",
        requestId: REQUEST,
        status: "CONVERTING",
        pausedUntil: null,
        counts: { queued: 1, extracting: 0, filling: 0, done: 1, failed: 0 },
        rowsSoFar: 22,
        estimatedSecondsRemaining: null,
        allowance: { used: 0, limit: 5000, resetsAt: "2026-09-15T00:00:00Z" },
        files: [
          {
            fileId: "file_1",
            fileName: "invoice-1044.pdf",
            schemaId: "sch_32",
            stage: "DONE",
            rowCount: 22,
          },
          { fileId: "file_2", fileName: "invoice-1043.pdf", schemaId: "sch_31", stage: "QUEUED" },
        ],
      }),
    )
    mockBackend()
    // The poll never answers, so anything on screen came out of the cache.
    server.use(http.post("/api/polling/result", () => new Promise(() => {})))
    await renderBatch("converting")

    expect(await screen.findByText("invoice-1044.pdf")).toBeVisible()
    expect(screen.getByText(/1 of 2 done/)).toBeVisible()
    expect(screen.getByRole("link", { name: /View/ })).toBeVisible()
  })

  it("asks straight away about a batch it did not convert itself", async () => {
    const seen = mockBackend({
      result: {
        userId: "usr_1",
        requestId: REQUEST,
        status: "CONVERTING",
        pausedUntil: null,
        counts: { queued: 1, extracting: 0, filling: 0, done: 1, failed: 0 },
        rowsSoFar: 22,
        estimatedSecondsRemaining: null,
        allowance: { used: 0, limit: 5000, resetsAt: "2026-09-15T00:00:00Z" },
        files: [
          {
            fileId: "file_1",
            fileName: "invoice-1044.pdf",
            schemaId: "sch_32",
            stage: "DONE",
            rowCount: 22,
            fieldCount: 6,
          },
          { fileId: "file_2", fileName: "invoice-1043.pdf", schemaId: "sch_31", stage: "QUEUED" },
        ],
      },
    })
    // No note in this browser at all, so there is no wait of ours to serve out.
    await renderBatch()

    expect(await screen.findByText(/1 of 2 done/)).toBeVisible()
    expect(seen.results).toBeGreaterThan(0)
  })

  it("opens on Converting when the server says the request was queued, note or no note", async () => {
    mockBackend({
      result: {
        userId: "usr_1",
        requestId: REQUEST,
        status: "CONVERTING",
        pausedUntil: null,
        counts: { queued: 1, extracting: 0, filling: 0, done: 1, failed: 0 },
        rowsSoFar: 22,
        estimatedSecondsRemaining: 840,
        allowance: { used: 1840, limit: 5000, resetsAt: "2026-09-15T00:00:00Z" },
        files: [
          {
            fileId: "file_1",
            fileName: "invoice-1044.pdf",
            schemaId: "sch_32",
            stage: "DONE",
            rowCount: 22,
            fieldCount: 6,
            toCheckCount: 3,
          },
          { fileId: "file_2", fileName: "invoice-1043.pdf", schemaId: "sch_31", stage: "QUEUED" },
        ],
      },
    })
    // No note at all — this browser has never seen this batch before.
    await renderBatch()

    expect(await screen.findByText(/1 of 2 done/)).toBeVisible()
    expect(screen.queryByRole("button", { name: /^Convert/ })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("quarry.workspace") ?? "[]")[0]?.phase).toBe(
        "converting",
      ),
    )
  })

  it("stays on Prepare when the server reports nothing queued", async () => {
    mockBackend()
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    await renderBatch()

    expect(await screen.findByRole("button", { name: /^Convert/ })).toBeVisible()
  })

  it("is honest when the browser holds nothing for this batch", async () => {
    mockBackend({ entries: [] })
    await renderBatch()
    expect(await screen.findByText("Nothing staged in this browser")).toBeVisible()
  })
})

/**
 * Convert is not gated on shapes, so pressing it with half the batch still
 * being read is ordinary — and the server has no table to report for a file it
 * has not finished reading. This browser has the names, which is the whole
 * difference between a screen with six files on it and a screen with one.
 */
describe("the results screen, before every shape is back", () => {
  const remember = (files: { fileId: string; fileName: string }[]) =>
    localStorage.setItem(
      `quarry.batch.${REQUEST}.files`,
      JSON.stringify(
        files.map((f) => ({
          ...f,
          fileLocation: f.fileName,
          size: 32,
          filePath: `${PUT_URL}/0`,
          expiresAt: "2026-09-14T11:05:00Z",
        })),
      ),
    )

  const partial = (over: Record<string, unknown> = {}) => ({
    userId: "usr_1",
    requestId: REQUEST,
    status: "CONVERTING",
    pausedUntil: null,
    counts: { queued: 0, extracting: 0, filling: 0, done: 0, failed: 0 },
    rowsSoFar: 0,
    estimatedSecondsRemaining: null,
    allowance: { used: 0, limit: 5000, resetsAt: "2026-09-15T00:00:00Z" },
    files: [],
    ...over,
  })

  it("names every file it is still reading rather than showing an empty list", async () => {
    mockBackend({ result: partial() })
    remember([
      { fileId: "file_1", fileName: "invoice-1043.pdf" },
      { fileId: "file_2", fileName: "invoice-1044.pdf" },
    ])
    await renderBatch("converting")

    expect(await screen.findByText("invoice-1043.pdf")).toBeVisible()
    expect(screen.getByText("invoice-1044.pdf")).toBeVisible()
    expect(screen.getAllByText("Detecting")).toHaveLength(2)
  })

  it("stands on Detecting Schema until one of them has a table", async () => {
    mockBackend({ result: partial() })
    remember([{ fileId: "file_1", fileName: "invoice-1043.pdf" }])
    const { container } = await renderBatch("converting")

    await screen.findByText("invoice-1043.pdf")
    expect(container.querySelector('[data-stage="detect"]')).toHaveAttribute("data-active")
    expect(container.querySelector('[data-stage="detect"] [data-count]')).toHaveTextContent("1")
  })

  it("counts the files without a table into the batch total, not out of it", async () => {
    mockBackend({
      result: partial({
        counts: { queued: 1, extracting: 0, filling: 0, done: 0, failed: 0 },
        files: [
          { fileId: "file_1", fileName: "invoice-1043.pdf", schemaId: "sch_31", stage: "QUEUED" },
        ],
      }),
    })
    remember([
      { fileId: "file_1", fileName: "invoice-1043.pdf" },
      { fileId: "file_2", fileName: "invoice-1044.pdf" },
    ])
    const { container } = await renderBatch("converting")

    // "0 of 1 done" above two rows would be a screen arguing with itself.
    expect(await screen.findByText(/0 of 2 done/)).toBeVisible()
    // And the one that is already being worked on is what the strip stands on.
    expect(container.querySelector('[data-stage="process"]')).toHaveAttribute("data-active")
  })

  it("puts the one count line in the footer, and does not repeat it over the table", async () => {
    mockBackend({
      result: partial({
        status: "COMPLETED",
        counts: { queued: 0, extracting: 0, filling: 0, done: 1, failed: 0 },
        rowsSoFar: 22,
        files: [
          {
            fileId: "file_1",
            fileName: "invoice-1043.pdf",
            schemaId: "sch_31",
            stage: "DONE",
            rowCount: 22,
          },
        ],
      }),
    })
    const { container } = await renderBatch("done")

    const line = await screen.findByText(/1 of 1 done/)
    expect(container.querySelector("footer")).toContainElement(line)
    // The tally it replaced said the same thing in a second set of numbers.
    expect(screen.queryByText(/rows so far/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/1 of 1 done/)).toHaveLength(1)
  })

  it("does not count a file the server gave up on among the ones it is reading", async () => {
    // No shape means no table, and no table means the result poll has nothing
    // to say about that file at all. Left to the count of names it would spin
    // a row for the rest of the run.
    localStorage.setItem(`quarry.batch.${REQUEST}.unreadable`, JSON.stringify(["file_2"]))
    mockBackend({
      result: partial({
        counts: { queued: 1, extracting: 0, filling: 0, done: 0, failed: 0 },
        files: [
          { fileId: "file_1", fileName: "invoice-1043.pdf", schemaId: "sch_31", stage: "QUEUED" },
        ],
      }),
    })
    remember([
      { fileId: "file_1", fileName: "invoice-1043.pdf" },
      { fileId: "file_2", fileName: "scan-0091.pdf" },
    ])
    await renderBatch("converting")

    expect(await screen.findByText("invoice-1043.pdf")).toBeVisible()
    expect(screen.queryByText("scan-0091.pdf")).not.toBeInTheDocument()
    expect(screen.queryByText("Detecting")).not.toBeInTheDocument()
    expect(screen.getByText(/0 of 1 done/)).toBeVisible()
  })

  // The result poll has nothing to say about a file with no shape, so the only
  // way to tell one apart from a file still being read is to ask for the
  // shapes. What this browser wrote before the gate cannot cover it: the schema
  // poll that records it stops the moment this screen replaces Prepare, and
  // converting before every shape is back is the whole flow these rows are for.
  it("asks for the shapes, so a file the server gave up on is not shown as reading", async () => {
    mockBackend({
      entries: [
        schemaEntry({
          fileId: "file_2",
          fileName: "scan-0091.pdf",
          schemaId: null,
          status: "failed",
          schema: null,
          failure: { class: "format_corrupt", message: "Not a PDF." },
        }),
      ],
      result: partial({
        counts: { queued: 1, extracting: 0, filling: 0, done: 0, failed: 0 },
        files: [
          { fileId: "file_1", fileName: "invoice-1043.pdf", schemaId: "sch_31", stage: "QUEUED" },
        ],
      }),
    })
    remember([
      { fileId: "file_1", fileName: "invoice-1043.pdf" },
      { fileId: "file_2", fileName: "scan-0091.pdf" },
    ])
    await renderBatch("converting")

    expect(await screen.findByText("invoice-1043.pdf")).toBeVisible()
    await waitFor(() => expect(screen.queryByText("Detecting")).not.toBeInTheDocument())
    expect(screen.queryByText("scan-0091.pdf")).not.toBeInTheDocument()
  })

  it("stops naming files without tables once the batch has finished", async () => {
    // Nothing the server never answered for is still being read by then, and a
    // row that spins forever is worse than one that is not there.
    mockBackend({
      result: partial({
        status: "COMPLETED",
        counts: { queued: 0, extracting: 0, filling: 0, done: 1, failed: 0 },
        files: [
          {
            fileId: "file_1",
            fileName: "invoice-1043.pdf",
            schemaId: "sch_31",
            stage: "DONE",
            rowCount: 4,
          },
        ],
      }),
    })
    remember([
      { fileId: "file_1", fileName: "invoice-1043.pdf" },
      { fileId: "file_2", fileName: "invoice-1044.pdf" },
    ])
    await renderBatch("done")

    expect(await screen.findByText("invoice-1043.pdf")).toBeVisible()
    expect(screen.queryByText("invoice-1044.pdf")).not.toBeInTheDocument()
    expect(screen.queryByText("Detecting")).not.toBeInTheDocument()
  })
})

describe("a poll that fails before anything has landed", () => {
  // These two screens used to answer a failed poll with a banner. It was
  // removed; the guards that deferred to it were not, and each left a screen
  // that renders nothing at all rather than saying so.
  it("keeps the results screen saying something while the first poll is failing", async () => {
    mockBackend()
    server.use(http.post("/api/polling/result", () => new HttpResponse(null, { status: 500 })))
    const { container } = await renderBatch("converting")

    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Reading the state of this batch" })).toBeVisible(),
    )
    expect(container.querySelector("main")).not.toBeEmptyDOMElement()
  })

  it("keeps the prepare screen saying something when the schema poll fails", async () => {
    mockBackend({ entries: [] })
    server.use(http.post("/api/polling/schema", () => new HttpResponse(null, { status: 500 })))
    await renderBatch()

    expect(await screen.findByText("Nothing staged in this browser")).toBeVisible()
  })
})

describe("Prepare — the batch nav", () => {
  const step = (container: HTMLElement, id: string) =>
    container.querySelector(`[data-step="${id}"]`)

  it("stays on Files while shapes are still coming back, however eager the gate is", async () => {
    // The server can report the gate open before this browser holds the shapes
    // to show. The rail follows the *screen*, not the flag: moving off Files
    // here would announce a screen change that has not happened.
    mockBackend({ entries: [], pending: 1, convertAvailable: true })
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    const { container } = await renderBatch()

    await waitFor(() => expect(step(container, "files")).toHaveAttribute("data-state", "current"))
    expect(step(container, "schemas")).toHaveAttribute("data-state", "upcoming")
    // The gate is not a place in the rail. Shapes are still coming back, and
    // nobody on this screen has asked to watch them come.
    expect(step(container, "convert")).toBeNull()
    expect(screen.queryByText("detecting")).not.toBeInTheDocument()
  })

  it("ticks Schemas once every file has settled a shape, without leaving Files", async () => {
    mockBackend({ entries: [schemaEntry()], pending: 0, convertAvailable: true })
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    const { container } = await renderBatch()

    await waitFor(() => expect(step(container, "schemas")).toHaveAttribute("data-state", "done"))
    // Uploading and reading every file does not move the rail. Pressing Review
    // schemas does, and nothing here has pressed it.
    expect(step(container, "files")).toHaveAttribute("data-state", "current")
  })

  it("never offers Convert as somewhere to go", async () => {
    mockBackend({ entries: [schemaEntry()], pending: 0, convertAvailable: true })
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    const { container } = await renderBatch()

    await waitFor(() => expect(step(container, "schemas")).toHaveAttribute("data-state", "done"))
    expect(step(container, "convert")).toBeNull()
    expect(screen.queryByText("Convert", { selector: "nav *" })).not.toBeInTheDocument()
  })
})

describe("the files a converted batch was built from", () => {
  /** The rail's Files step, once the batch is past the gate. */
  const renderFrozenFiles = () => renderBatch("done", { view: "files" })

  it("opens the drop again rather than the results", async () => {
    mockBackend()
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    await renderFrozenFiles()

    expect(await screen.findByText("invoice-1043.pdf")).toBeVisible()
  })

  it("takes nothing new, and undoes nothing that was taken", async () => {
    mockBackend()
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    await renderFrozenFiles()
    await screen.findByText("invoice-1043.pdf")

    // The batch was converted against this drop. Adding to it or removing from
    // it would describe work the server has already done differently.
    expect(screen.queryByRole("button", { name: "Drop more files" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Convert/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Review Schemas/ })).not.toBeInTheDocument()
  })

  it("says why it cannot be changed, and offers the way back", async () => {
    mockBackend()
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    await renderFrozenFiles()
    await screen.findByText("invoice-1043.pdf")

    expect(screen.getByText(/has been converted/)).toBeVisible()
    expect(screen.getByRole("link", { name: "Go to results" })).toHaveAttribute(
      "href",
      `/request/${REQUEST}`,
    )
  })

  it("keeps the rail on Files, with the gate already behind it", async () => {
    mockBackend()
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    const { container } = await renderFrozenFiles()
    await screen.findByText("invoice-1043.pdf")

    expect(container.querySelector('[data-step="files"]')).toHaveAttribute(
      "data-state",
      "current",
    )
    // The gate was never a place in the rail, and the waits either side of it
    // are over.
    expect(container.querySelector('[data-step="convert"]')).toBeNull()
    expect(screen.queryByText("converting")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Results" })).toBeVisible()
  })

  it("serves the results, not the drop, when the view is not asked for", async () => {
    mockBackend()
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    await renderBatch("done")

    expect(screen.queryByRole("button", { name: "Drop more files" })).not.toBeInTheDocument()
    expect(screen.queryByText(/has been converted/)).not.toBeInTheDocument()
  })
})
