import { describe, expect, it } from "vitest"
import { render, screen } from "@/test/render"
import type { WorkspaceBatch } from "@/state/workspace"
import { BatchCard } from "./BatchCard"

const base: WorkspaceBatch = {
  requestId: "req_01KABC",
  name: "Q3 invoices",
  createdAt: "2026-09-14T10:42:00Z",
  fileCount: 41,
  phase: "prepare",
  summary: {},
}

describe("BatchCard", () => {
  it("is headed by when the batch was dropped, not by a name", () => {
    render(<BatchCard batch={base} />)
    // "Batch of 14 Sep" was the date written twice, and a dropped folder's name
    // made two drops of the same folder into two identical cards.
    expect(screen.getByText(/^September 14, 2026 · \d{1,2}:\d{2} (AM|PM)$/)).toBeVisible()
    expect(screen.queryByText("Q3 invoices")).not.toBeInTheDocument()
  })

  it("heads a dropped folder the same way — the time is what tells two apart", () => {
    render(<BatchCard batch={{ ...base, name: "Q3 invoices" }} />)
    expect(screen.getByText(/^September 14, 2026 · /)).toBeVisible()
  })

  it("counts the files alone until there is anything to count beside them", () => {
    render(<BatchCard batch={base} />)
    expect(screen.getByText("41 files")).toBeVisible()
  })

  it("counts files, tables and rows once the batch has them", () => {
    render(
      <BatchCard batch={{ ...base, phase: "done", summary: { tables: 41, rows: 612 } }} />,
    )
    expect(screen.getByText("41 files · 41 tables · 612 rows")).toBeVisible()
  })

  it("keeps the right-hand side to the status and nothing else", () => {
    render(
      <BatchCard
        batch={{ ...base, phase: "converting", summary: { tables: 18, etaSeconds: 840 } }}
      />,
    )
    expect(screen.getByText("Converting")).toBeVisible()
    // The counts under the chip were the same numbers as the line on the left,
    // arranged differently — two readings of one batch on one card.
    expect(screen.queryByText(/18 of 41 done/)).not.toBeInTheDocument()
    expect(screen.queryByText(/about 14 min left/)).not.toBeInTheDocument()
    expect(screen.queryByText(/waiting on you/)).not.toBeInTheDocument()
  })

  it("says a batch is still waiting on you", () => {
    render(<BatchCard batch={base} />)
    expect(screen.getByText("Awaiting your schemas")).toBeVisible()
  })

  it("shows a paused batch as paused", () => {
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
  })

  it("marks a finished batch neutrally — the accent is not a status", () => {
    const { container } = render(
      <BatchCard batch={{ ...base, phase: "done", summary: { tables: 41, rows: 612 } }} />,
    )
    expect(screen.getByText("Done")).toBeVisible()
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

  // Where a batch got to is what you scan a list of these for. Set beside it,
  // a "1 failed" pushed Done left and broke that column on exactly the cards
  // worth finding.
  it("keeps the status on its own row, so its chip holds one right edge", () => {
    const { container } = render(
      <BatchCard
        batch={{ ...base, phase: "done", summary: { tables: 5, rows: 140, failed: 1, toCheck: 3 } }}
      />,
    )
    const status = screen.getByText("Done")
    const note = screen.getByText("1 failed")
    // Not siblings: the note sits in a row of its own underneath.
    expect(note.parentElement).not.toBe(status.parentElement)
    expect(status.parentElement).toContainElement(note.parentElement)
    expect(status.parentElement?.className).toContain("flex-col")
    expect(screen.getByText("3 to check").parentElement).toBe(note.parentElement)
    expect(container.querySelector(".items-end")).not.toBeNull()
  })

  it("is plain about a batch where nothing could be read, and counts it once", () => {
    render(<BatchCard batch={{ ...base, phase: "failed", summary: { failed: 41 } }} />)
    expect(screen.getByText("Nothing usable")).toBeVisible()
    expect(screen.queryByText("41 failed")).not.toBeInTheDocument()
  })

  // The card says what the last poll said, and `useWorkspaceRefresh` is what
  // makes sure that was recent. Deriving "it must have finished by now" from
  // the counts instead read them against `fileCount`, which the poll overwrites
  // with the number of TABLES it knows about — so a batch with three of eight
  // files detected and all three tables done settled itself as Done while five
  // files were still being read.
  it("says what the batch's own phase says, and does not second-guess it", () => {
    render(
      <BatchCard
        batch={{
          ...base,
          fileCount: 3,
          phase: "converting",
          summary: { tables: 3, rows: 140, failed: 0 },
        }}
      />,
    )
    expect(screen.getByText("Converting")).toBeVisible()
    expect(screen.queryByText("Done")).not.toBeInTheDocument()
  })

  it("links through to the batch", () => {
    render(<BatchCard batch={base} />)
    expect(screen.getByRole("link")).toHaveAttribute("href", "/request/req_01KABC")
  })
})
