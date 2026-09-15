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

async function renderBatch(phase?: WorkspaceBatch["phase"]) {
  const params = Promise.resolve({ requestId: REQUEST })
  const searchParams = Promise.resolve({})
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

  it("counts uploads and shapes as two clocks on the footer", async () => {
    mockBackend()
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf"), file("invoice-1044.pdf")]))
    await renderBatch()

    expect(await screen.findByText("2 of 2 uploaded")).toBeVisible()
    // One entry came back for one of the two files, so one file has its shape.
    expect(screen.getByText("1 of 2 schemas back")).toBeVisible()
  })

  it("keeps a rejected file on screen with its reason, and uploads the rest", async () => {
    const seen = mockBackend()
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf"), file("q3-archive.zip")]))
    await renderBatch()

    expect(await screen.findByText(/unzip it first/i)).toBeVisible()
    await waitFor(() => expect(seen.confirmed).toHaveLength(1))
  })

  it("keeps the eye present but gated while that file's schema is still coming", async () => {
    mockBackend({ entries: [], pending: 2, convertAvailable: false, convertBlockedReason: "2 files are still reading their shape." })
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    await renderBatch()

    expect(await screen.findByRole("button", { name: "Loading schema" })).toBeDisabled()
  })

  it("opens the schema in a panel beside the list, not over it", async () => {
    mockBackend()
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    const { user } = await renderBatch()

    await user.click(await screen.findByRole("button", { name: "Open schema" }))
    const panel = screen.getByRole("complementary", { name: "Schema" })
    expect(within(panel).getByText("invoice_number")).toBeVisible()
    // The list is still there beside it.
    expect(screen.getAllByText("invoice-1043.pdf").length).toBeGreaterThan(1)
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

  it("says a file has no table rather than that it is still reading", async () => {
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

    expect(
      await screen.findByRole("button", { name: "No table was found in this file" }),
    ).toBeDisabled()
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

  it("sends one entry per affected (fileId, schemaId) when applying to all", async () => {
    let saved: { files: { fileId: string; schemaId: string }[] } | null = null
    mockBackend({
      entries: [
        schemaEntry(),
        schemaEntry({ fileId: "file_2", fileName: "invoice-1044.pdf", schemaId: "sch_32" }),
      ],
    })
    server.use(
      http.post("/api/updateSchema", async ({ request }) => {
        saved = (await request.json()) as typeof saved
        return HttpResponse.json({
          status: "ok",
          updated: saved!.files.map((f) => ({ schemaId: f.schemaId, version: 2 })),
        })
      }),
    )
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf"), file("invoice-1044.pdf")]))
    const { user } = await renderBatch()

    await user.click((await screen.findAllByRole("button", { name: "Open schema" }))[0])
    const panel = screen.getByRole("complementary", { name: "Schema" })

    await user.click(within(panel).getByRole("combobox", { name: "Type of total" }))
    await user.click(screen.getByRole("option", { name: "currency" }))
    await user.click(within(panel).getByRole("button", { name: "Apply to 1 file" }))
    await user.click(screen.getByRole("button", { name: "Include these 1" }))
    await user.click(within(panel).getByRole("button", { name: "Save" }))

    await waitFor(() => expect(saved).not.toBeNull())
    expect(saved!.files).toHaveLength(2)
    expect(saved!.files.map((f) => `${f.fileId}:${f.schemaId}`).sort()).toEqual([
      "file_1:sch_31",
      "file_2:sch_32",
    ])
    // The same edited field list goes to each of them.
    for (const entry of saved!.files as unknown as {
      schema: { fields: { key: string; type: string }[] }
    }[]) {
      expect(entry.schema.fields.find((f) => f.key === "total")?.type).toBe("currency")
    }
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
    expect(screen.queryByRole("button", { name: /Open schema|Loading schema/ })).not.toBeInTheDocument()
  })

  it("gives a many-table file one eye, and opens every table behind it", async () => {
    mockBackend({
      entries: [
        schemaEntry({ schemaId: "sch_1", schema: { ...schemaEntry().schema!, tableLabel: "table 1" } }),
        schemaEntry({ schemaId: "sch_2", schema: { ...schemaEntry().schema!, tableLabel: "table 2" } }),
        schemaEntry({ schemaId: "sch_3", schema: { ...schemaEntry().schema!, tableLabel: "table 3" } }),
      ],
    })
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    const { user } = await renderBatch()

    const eye = await screen.findByRole("button", { name: "Open 3 tables" })
    // One row, one eye — never one button per table.
    expect(screen.getAllByRole("button", { name: /Open 3 tables/ })).toHaveLength(1)
    expect(await screen.findByText(/· 3 tables/)).toBeVisible()

    await user.click(eye)
    const panel = screen.getByRole("complementary", { name: "Schema" })
    expect(within(panel).getAllByRole("tab")).toHaveLength(3)
    expect(within(panel).getByRole("tab", { name: "table 3" })).toBeVisible()
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
    // Its shape is already being read on the server, so it settles from the
    // poll — and the eye, not the row, is what says so.
    expect(await screen.findByRole("button", { name: "Open schema" })).toBeEnabled()
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

  it("waits out the two minutes before asking how a batch it just converted is doing", async () => {
    const seen = mockBackend()
    stageForRequest(REQUEST, stageFiles([file("invoice-1043.pdf")]))
    const { user } = await renderBatch("prepare")

    await user.click(await screen.findByRole("button", { name: /^Convert/ }))
    await waitFor(() => expect(seen.converts).toBe(1))

    // The probe is skipped for a batch this browser staged, and the result
    // poll is holding: nothing has asked the server how it is going.
    await waitFor(() => expect(screen.getByText("Converting")).toBeVisible())
    expect(seen.results).toBe(0)
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
