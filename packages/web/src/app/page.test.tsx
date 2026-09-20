import { http, HttpResponse } from "msw"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@/test/render"
import { server } from "@/test/msw/server"
import { peekStagedFiles } from "@/state/staged"
import { WorkspaceProvider, type WorkspaceBatch } from "@/state/workspace"
import WorkspacePage from "./page"

const push = vi.fn()
const replace = vi.fn()

const router = { push, replace }

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

const registers = () =>
  server.use(http.post("/api/register", () => HttpResponse.json({ status: "ok" })))

const batch = (over: Partial<WorkspaceBatch> = {}): WorkspaceBatch => ({
  requestId: "req_a",
  name: "Q3 invoices",
  createdAt: "2026-09-14T10:00:00Z",
  fileCount: 41,
  phase: "prepare",
  summary: {},
  ...over,
})

/** The hero card, as opposed to the sticky strip that says the same things. */
const card = () => screen.getByTestId("drop-card")

const renderPage = () =>
  render(
    <WorkspaceProvider>
      <WorkspacePage />
    </WorkspaceProvider>,
  )

describe("S01 workspace", () => {
  it("shows the drop zone as the page on a first visit, with no pretend content", async () => {
    registers()
    renderPage()
    expect(await within(card()).findByText("Drop your documents here")).toBeVisible()
    await waitFor(() => expect(screen.getByText("Nothing here yet")).toBeVisible())
  })

  it("opens on the intro the first time this browser lands here", async () => {
    registers()
    renderPage()
    expect(await screen.findByRole("dialog", { name: "Anything in. Tables out." })).toBeVisible()
  })

  // A returning user is here to start their fifth batch, not to watch a demo.
  it("skips the intro once it has played", async () => {
    registers()
    localStorage.setItem("quarry.introSeen", "1")
    renderPage()
    await within(card()).findByText("Drop your documents here")
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("lists the batches this browser is holding, under History", async () => {
    registers()
    localStorage.setItem("quarry.workspace", JSON.stringify([batch()]))
    renderPage()
    // A card is headed by when it was dropped. The name it used to carry was
    // either the date written twice or the folder's, which two drops share.
    expect(await screen.findByText(/^September 14, 2026 · /)).toBeVisible()
    expect(screen.getByRole("heading", { name: "History" })).toBeVisible()
    expect(screen.getByText("Awaiting your schemas")).toBeVisible()
  })

  // Every card is a note this browser wrote while it was watching that batch.
  // Close the results screen before the last file lands and the note stops
  // being true — a batch that finished with a failure in it goes on saying
  // Converting, over counts from the moment the screen was closed.
  it("catches up a card it last saw running, rather than trusting its own note", async () => {
    registers()
    let asked = 0
    server.use(
      http.post("/api/polling/result", () => {
        asked += 1
        return HttpResponse.json({
          userId: "usr_1",
          requestId: "req_a",
          status: "COMPLETED",
          pausedUntil: null,
          counts: { queued: 0, extracting: 0, filling: 0, done: 5, failed: 1 },
          rowsSoFar: 140,
          estimatedSecondsRemaining: null,
          allowance: { used: 0, limit: 5000, resetsAt: "2026-09-15T00:00:00Z" },
          files: [],
        })
      }),
    )
    localStorage.setItem(
      "quarry.workspace",
      JSON.stringify([batch({ phase: "converting", fileCount: 6, summary: { tables: 2 } })]),
    )
    renderPage()

    expect(await screen.findByText("Done")).toBeVisible()
    expect(screen.getByText("1 failed")).toBeVisible()
    expect(screen.getByText("6 files · 5 tables · 140 rows")).toBeVisible()
    expect(screen.queryByText("Converting")).not.toBeInTheDocument()
    // Once, on the way in. The workspace is a list of things already done, not
    // a screen that re-asks about six batches every few seconds.
    expect(asked).toBe(1)
  })

  it("leaves a settled card alone — there is nothing for it to catch up on", async () => {
    registers()
    let asked = 0
    server.use(
      http.post("/api/polling/result", () => {
        asked += 1
        return new HttpResponse(null, { status: 500 })
      }),
    )
    localStorage.setItem(
      "quarry.workspace",
      JSON.stringify([batch({ phase: "done", summary: { tables: 41, rows: 612 } })]),
    )
    renderPage()

    expect(await screen.findByText("Done")).toBeVisible()
    expect(asked).toBe(0)
  })

  it("offers a retry, not a dead end, when the workspace cannot be registered", async () => {
    server.use(http.post("/api/register", () => new HttpResponse("no", { status: 500 })))
    renderPage()
    expect(await screen.findByText("Couldn't open your workspace")).toBeVisible()
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible()
  })

  it("stages a drop against a fresh request and moves to it", async () => {
    registers()
    renderPage()
    const zone = card()
    await waitFor(() => expect(zone).toHaveAttribute("data-state", "idle"))

    fireEvent.drop(zone, {
      dataTransfer: { types: ["Files"], files: [new File(["x"], "invoice-1043.pdf")] },
    })

    await waitFor(() => expect(push).toHaveBeenCalled())
    const href = push.mock.calls.at(-1)?.[0] as string
    expect(href).toMatch(/^\/request\/req_/)
    const requestId = href.split("/").at(-1)!
    expect(peekStagedFiles(requestId)).toHaveLength(1)
  })

  it("refuses the drop until the workspace has woken up, and says so", async () => {
    const released = Promise.withResolvers<void>()
    server.use(
      http.post("/api/register", async () => {
        await released.promise
        return HttpResponse.json({ status: "ok" })
      }),
    )
    renderPage()
    const zone = card()
    expect(zone).toHaveAttribute("data-state", "disabled")
    expect(within(zone).getByText("Waking up your workspace — one moment.")).toBeVisible()
    released.resolve()
  })

  // jsdom has no layout and no IntersectionObserver, so what the strip does
  // on screen cannot be asserted here. What can be is the thing that was
  // wrong: the marker it watches has to be above the card. Below it, the
  // strip asked for the card's full height in scroll — more page than a
  // workspace with a handful of batches has — and never appeared at all.
  it("watches for the top of the drop card, not the bottom", async () => {
    registers()
    localStorage.setItem("quarry.introSeen", "1")
    const { container } = renderPage()
    await within(card()).findByText("Drop your documents here")

    const marker = container.querySelector("main > div.h-px")
    expect(marker).not.toBeNull()
    expect(marker!.compareDocumentPosition(card()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
