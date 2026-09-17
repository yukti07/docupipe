import { describe, expect, it } from "vitest"
import { render, screen } from "@/test/render"
import type { WorkspaceBatch } from "@/state/workspace"
import { BatchCard } from "./BatchCard"

const base: WorkspaceBatch = {
  requestId: "req_01KABC",
  name: "Q3 invoices",
  createdAt: "2026-09-14T10:00:00Z",
  fileCount: 41,
  phase: "prepare",
  summary: {},
}

describe("BatchCard", () => {
  it("says a batch is still waiting on you, and how many files that is", () => {
    render(<BatchCard batch={base} />)
    expect(screen.getByText("Awaiting your schemas")).toBeVisible()
    expect(screen.getByText("41 waiting on you")).toBeVisible()
  })

  it("counts live while converting, with a vague eta", () => {
    render(
      <BatchCard
        batch={{ ...base, phase: "converting", summary: { tables: 18, etaSeconds: 840 } }}
      />,
    )
    expect(screen.getByText("Converting")).toBeVisible()
    expect(screen.getByText(/18 of 41 done · about 14 min left/)).toBeVisible()
  })

  it("shows where a paused batch stopped and when it resumes", () => {
    render(
      <BatchCard
        batch={{
          ...base,
          phase: "paused",
          summary: { tables: 140, pausedUntil: "2026-09-14T14:32:00Z" },
        }}
      />,
    )
    expect(screen.getByText("Paused")).toBeVisible()
    expect(screen.getByText(/picking up again at \d{2}:\d{2}/)).toBeVisible()
  })

  it("marks a finished batch neutrally — the accent is not a status", () => {
    const { container } = render(
      <BatchCard batch={{ ...base, phase: "done", summary: { tables: 41, rows: 612 } }} />,
    )
    expect(screen.getByText("Done")).toBeVisible()
    expect(screen.getByText("612 rows across 41 tables")).toBeVisible()
    expect(container.innerHTML).not.toContain("bg-review-bg")
  })

  it("says how many failed on a batch that finished with failures", () => {
    render(
      <BatchCard
        batch={{ ...base, phase: "done", summary: { tables: 39, rows: 590, failed: 2, toCheck: 3 } }}
      />,
    )
    expect(screen.getByText("Done")).toBeVisible()
    expect(screen.getByText("2 failed")).toBeVisible()
    expect(screen.getByText("3 to check")).toBeVisible()
  })

  it("is plain about a batch where nothing could be read", () => {
    render(<BatchCard batch={{ ...base, phase: "failed", summary: { failed: 41 } }} />)
    expect(screen.getByText("Nothing usable")).toBeVisible()
    expect(screen.getByText("none of these could be read")).toBeVisible()
  })

  it("links through to the batch", () => {
    render(<BatchCard batch={base} />)
    expect(screen.getByRole("link")).toHaveAttribute("href", "/request/req_01KABC")
  })
})
