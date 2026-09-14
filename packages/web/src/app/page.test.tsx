import { http, HttpResponse } from "msw"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@/test/render"
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
    expect(await screen.findByText("Drop your documents here")).toBeVisible()
    await waitFor(() => expect(screen.getByText("No batches yet")).toBeVisible())
  })

  it("lists the batches this browser is holding", async () => {
    registers()
    localStorage.setItem("quarry.workspace", JSON.stringify([batch()]))
    renderPage()
    expect(await screen.findByText("Q3 invoices")).toBeVisible()
    expect(screen.getByText("Awaiting your schemas")).toBeVisible()
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
    const zone = (await screen.findByText("Drop your documents here")).closest("[data-state]")!
    await waitFor(() => expect(zone).toHaveAttribute("data-state", "idle"))

    fireEvent.drop(zone, {
      dataTransfer: { types: ["Files"], files: [new File(["x"], "invoice-1043.pdf")] },
    })

    await waitFor(() => expect(push).toHaveBeenCalled())
    const href = push.mock.calls.at(-1)?.[0] as string
    expect(href).toMatch(/^\/b\/req_/)
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
    const zone = (await screen.findByText("Drop your documents here")).closest("[data-state]")!
    expect(zone).toHaveAttribute("data-state", "disabled")
    expect(screen.getByText("Waking up your workspace — one moment.")).toBeVisible()
    released.resolve()
  })
})
