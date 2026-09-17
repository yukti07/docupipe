import { http, HttpResponse } from "msw"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@/test/render"
import { server } from "@/test/msw/server"
import { api } from "@/lib/api"
import type { ResultPollResponse, TableData } from "@/lib/api/types"
import { ConnectionStatus } from "./ConnectionStatus"
import { DownloadAllDialog } from "./DownloadAllDialog"
import { DownloadTableButton } from "./DownloadTableButton"

const table: TableData = {
  requestId: "req_1",
  schemaId: "sch_32",
  fileId: "file_1",
  fileName: "invoice-1044.pdf",
  tableLabel: "table 1",
  pageRange: "1–3",
  fields: [{ key: "total", label: "total", type: "currency", origin: "detected" }],
  rows: [
    { recordId: "r1", values: { total: { valueId: "v1", display: "10.00", state: "value" } } },
  ],
}

const result = (over: Partial<ResultPollResponse> = {}): ResultPollResponse => ({
  userId: "u",
  requestId: "req_1",
  status: "COMPLETED",
  pausedUntil: null,
  counts: { queued: 0, extracting: 0, filling: 0, done: 2, failed: 4 },
  rowsSoFar: 36,
  estimatedSecondsRemaining: null,
  allowance: { used: 1840, limit: 5000, resetsAt: "2026-09-15T00:00:00Z" },
  files: [
    {
      fileId: "f1",
      fileName: "invoice-1043.pdf",
      schemaId: "sch_31",
      stage: "DONE",
      rowCount: 14,
      toCheckCount: 3,
    },
    {
      fileId: "f2",
      fileName: "invoice-1044.pdf",
      schemaId: "sch_32",
      stage: "DONE",
      rowCount: 22,
      toCheckCount: 0,
    },
  ],
  ...over,
})

function captureDownloads() {
  const clicked: { name: string }[] = []
  const createObjectURL = vi.fn(() => "blob:mock")
  Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true })
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true })
  const realClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    clicked.push({ name: this.download })
  }
  return {
    clicked,
    restore: () => {
      HTMLAnchorElement.prototype.click = realClick
    },
  }
}

describe("DownloadTableButton", () => {
  it("downloads in one click, with no dialog in the way", async () => {
    const downloads = captureDownloads()
    const { user } = render(<DownloadTableButton table={table} />)
    await user.click(screen.getByRole("button", { name: /Download/ }))
    expect(downloads.clicked.map((d) => d.name)).toEqual(["invoice-1044.csv"])
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    downloads.restore()
  })
})

describe("DownloadAllDialog", () => {
  // The dialog fetches every finished table through `api.getTable`, which is a
  // live route now rather than a fixture — so the route is what gets stubbed.
  beforeEach(() => {
    server.use(
      http.post("/api/table", async ({ request }) => {
        const { schemaId } = (await request.json()) as { schemaId: string }
        return HttpResponse.json({
          ...table,
          schemaId,
          fileName: schemaId === "sch_31" ? "invoice-1043.pdf" : "invoice-1044.pdf",
        })
      }),
    )
  })

  it("carries the row count on the button", () => {
    render(<DownloadAllDialog requestId="req_1" result={result()} />)
    expect(screen.getByRole("button", { name: /Download all · 36 rows/ })).toBeEnabled()
  })

  it("shows the honest summary before the download, not after", async () => {
    const { user } = render(<DownloadAllDialog requestId="req_1" result={result()} />)
    await user.click(screen.getByRole("button", { name: /Download all/ }))
    expect(screen.getByText("36 rows across 2 tables")).toBeVisible()
    expect(screen.getByText("4 files failed")).toBeVisible()
    expect(screen.getByText("3 cells worth a look")).toBeVisible()
    expect(screen.getByText(/never as a zero/)).toBeVisible()
  })

  it("is off with a reason when every file failed", () => {
    render(
      <DownloadAllDialog
        requestId="req_1"
        result={result({
          counts: { queued: 0, extracting: 0, filling: 0, done: 0, failed: 4 },
          files: [],
        })}
      />,
    )
    expect(screen.getByText("Every file failed, so there is nothing to download")).toBeVisible()
    expect(screen.getByRole("button", { name: /Download all/ })).toBeDisabled()
  })

  it("writes one file per finished table", async () => {
    const downloads = captureDownloads()
    const { user } = render(<DownloadAllDialog requestId="req_1" result={result()} />)
    await user.click(screen.getByRole("button", { name: /Download all/ }))
    await user.click(screen.getByRole("button", { name: "Download" }))
    await waitFor(() => expect(downloads.clicked).toHaveLength(2))
    expect(downloads.clicked.every((d) => d.name.endsWith(".csv"))).toBe(true)
    downloads.restore()
  })

  it("keeps the tables that came back when one of them does not", async () => {
    const downloads = captureDownloads()
    const real = api.getTable
    vi.spyOn(api, "getTable").mockImplementation((requestId, schemaId) =>
      schemaId === "sch_31" ? Promise.reject(new Error("gone")) : real(requestId, schemaId),
    )
    const { user } = render(<DownloadAllDialog requestId="req_1" result={result()} />)
    await user.click(screen.getByRole("button", { name: /Download all/ }))
    await user.click(screen.getByRole("button", { name: "Download" }))

    // One table refusing is a reason to be short a file, not a reason to get none.
    await waitFor(() => expect(downloads.clicked).toHaveLength(1))
    expect(screen.getByText(/1 of 2 tables downloaded/)).toBeVisible()
    vi.restoreAllMocks()
    downloads.restore()
  })

  it("writes tab separated files when that format is chosen", async () => {
    const downloads = captureDownloads()
    const { user } = render(<DownloadAllDialog requestId="req_1" result={result()} />)
    await user.click(screen.getByRole("button", { name: /Download all/ }))
    await user.click(screen.getByRole("button", { name: "Tab separated" }))
    await user.click(screen.getByRole("button", { name: "Download" }))
    await waitFor(() => expect(downloads.clicked).toHaveLength(2))
    expect(downloads.clicked.every((d) => d.name.endsWith(".tsv"))).toBe(true)
    downloads.restore()
  })
})

describe("ConnectionStatus", () => {
  it("shows nothing while the connection is fine", () => {
    const { container } = render(<ConnectionStatus failure={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("says it is reconnecting and that the last known state is still shown", () => {
    render(<ConnectionStatus failure={{ class: "network" }} />)
    expect(screen.getByText(/Reconnecting. The last known state is still shown/)).toBeVisible()
  })

  it("says offline rather than implying what is on screen is current", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true })
    render(<ConnectionStatus failure={null} />)
    expect(screen.getByText(/it may have moved on since/)).toBeVisible()
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true })
  })
})
