import { describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@/test/render"
import type { ResultEntry, ResultPollResponse } from "@/lib/api/types"
import { ConvertBar } from "./ConvertBar"
import { PausedBanner } from "./PausedBanner"
import { PipelineStrip } from "./PipelineStrip"
import { StatusSentence, shapesSentence, statusSentence } from "./StatusSentence"
import { TableList } from "./TableList"

const entry = (over: Partial<ResultEntry> = {}): ResultEntry => ({
  fileId: "file_1",
  fileName: "invoice-1043.pdf",
  schemaId: "sch_31",
  stage: "QUEUED",
  ...over,
})

const result = (over: Partial<ResultPollResponse> = {}): ResultPollResponse => ({
  userId: "u",
  requestId: "req_1",
  status: "CONVERTING",
  pausedUntil: null,
  counts: { queued: 61, extracting: 1, filling: 1, done: 127, failed: 4 },
  rowsSoFar: 4912,
  estimatedSecondsRemaining: 840,
  allowance: { used: 1840, limit: 5000, resetsAt: "2026-09-15T00:00:00Z" },
  files: [],
  ...over,
})

describe("StatusSentence", () => {
  it("reads true while running", () => {
    const running = result({
      counts: { queued: 59, extracting: 1, filling: 1, done: 127, failed: 4 },
      files: [entry({ stage: "DONE", toCheckCount: 8 })],
    })
    expect(statusSentence(running)).toBe("127 of 192 done · 61 waiting · 8 to check · 4 failed")
  })

  it("reads true when paused, with the time it picks up again", () => {
    const paused = result({
      status: "PAUSED",
      pausedUntil: "2026-09-14T14:32:00Z",
      counts: { queued: 60, extracting: 0, filling: 0, done: 140, failed: 0 },
    })
    expect(statusSentence(paused)).toMatch(/^140 of 200 done · picking up again at \d{2}:\d{2}$/)
  })

  it("reads true when finished, and drops the waiting count", () => {
    const finished = result({
      status: "COMPLETED",
      counts: { queued: 0, extracting: 0, filling: 0, done: 196, failed: 4 },
      files: [entry({ stage: "DONE", toCheckCount: 8 })],
    })
    expect(statusSentence(finished)).toBe("196 of 200 done · 8 to check · 4 failed")
  })

  it("says the unflattering thing when nothing could be read", () => {
    const failed = result({
      status: "FAILED",
      counts: { queued: 0, extracting: 0, filling: 0, done: 0, failed: 200 },
    })
    expect(statusSentence(failed)).toBe("0 of 200 done · none of these could be read")
  })

  it("announces itself politely rather than stealing focus", () => {
    render(<StatusSentence result={result()} />)
    expect(screen.getByText(/done/)).toHaveAttribute("aria-live", "polite")
  })

  it("counts shapes instead of tables on the prepare screen", () => {
    expect(shapesSentence({ uploaded: 6, total: 6, schemas: 5, failed: 0 })).toBe(
      "6 of 6 uploaded · 5 schemas back",
    )
    expect(shapesSentence({ uploaded: 41, total: 41, schemas: 39, failed: 2 })).toBe(
      "41 of 41 uploaded · 39 schemas back · 2 without a shape",
    )
  })
})

describe("PipelineStrip", () => {
  it("shows four stage counts that sum to the batch total, failures included", () => {
    const counts = { queued: 19, extracting: 1, filling: 1, done: 18, failed: 2 }
    render(<PipelineStrip counts={counts} />)
    const shown = ["19", "1", "1", "20"].map((n) => screen.getAllByText(n).length)
    expect(shown.every((count) => count > 0)).toBe(true)
    expect(screen.getByText("2 of them failed")).toBeVisible()
    expect(screen.getByText(/41 tables in total/)).toBeInTheDocument()
  })

  it("lights two stages at once, because two are genuinely running", () => {
    const { container } = render(
      <PipelineStrip counts={{ queued: 0, extracting: 1, filling: 1, done: 0, failed: 0 }} />,
    )
    expect(container.querySelectorAll("[data-active]")).toHaveLength(2)
  })

  it("leaves the motion to motion-safe so the counts still update under reduced motion", () => {
    const { container } = render(
      <PipelineStrip counts={{ queued: 1, extracting: 1, filling: 0, done: 0, failed: 0 }} />,
    )
    const animated = container.querySelector(".motion-safe\\:animate-pulse")
    expect(animated).toBeTruthy()
    expect(container.querySelector(".animate-pulse:not(.motion-safe\\:animate-pulse)")).toBeNull()
  })
})

describe("PausedBanner", () => {
  it("renders in the paused tone, never amber and never red", () => {
    const { container } = render(<PausedBanner pausedUntil="2026-09-14T14:32:00Z" />)
    const box = container.firstElementChild!
    expect(box.className).toContain("bg-paused-bg")
    expect(box.className).not.toContain("review")
    expect(box.className).not.toContain("error")
  })

  it("states the resume time and that nothing finished is lost", () => {
    render(<PausedBanner pausedUntil="2026-09-14T14:32:00Z" />)
    expect(screen.getByText(/Picking up again at \d{2}:\d{2}/)).toBeVisible()
    expect(screen.getByText(/stays open and downloadable/)).toBeVisible()
  })

  it("names a processing cap differently from a daily allowance", () => {
    render(<PausedBanner pausedUntil={null} reason="user-cap" />)
    expect(screen.getByText(/hit your processing cap/)).toBeVisible()
  })
})

describe("TableList", () => {
  it("gives a finished row View and Download, in place", () => {
    render(
      <TableList
        requestId="req_1"
        entries={[entry({ stage: "DONE", rowCount: 22, fieldCount: 6, toCheckCount: 3 })]}
      />,
    )
    expect(screen.getByRole("link", { name: /View/ })).toHaveAttribute(
      "href",
      "/b/req_1/t/sch_31",
    )
    expect(screen.getByRole("link", { name: /Download/ })).toBeVisible()
    expect(screen.getByText("22 rows · 6 fields · 3 to check")).toBeVisible()
  })

  it("keeps the order it was given — a finished row never jumps the queue", () => {
    render(
      <TableList
        requestId="req_1"
        entries={[
          entry({ schemaId: "sch_1", fileName: "a.pdf", stage: "QUEUED" }),
          entry({ schemaId: "sch_2", fileName: "b.pdf", stage: "DONE", rowCount: 4 }),
          entry({ schemaId: "sch_3", fileName: "c.pdf", stage: "QUEUED" }),
        ]}
      />,
    )
    const names = screen.getAllByText(/\.pdf$/).map((el) => el.textContent)
    expect(names).toEqual(["a.pdf", "b.pdf", "c.pdf"])
  })

  it("calls a conversion failure what it is, not an upload failure", () => {
    render(
      <TableList
        requestId="req_1"
        entries={[entry({ stage: "FAILED", failure: { class: "format_locked" } })]}
      />,
    )
    expect(screen.getByText("Couldn't convert it")).toBeVisible()
    expect(screen.queryByText("Upload failed")).not.toBeInTheDocument()
  })

  it("states why a failed row failed, on the row", () => {
    render(
      <TableList
        requestId="req_1"
        entries={[
          entry({
            stage: "FAILED",
            failure: { class: "format_locked", message: "Password-protected." },
          }),
        ]}
      />,
    )
    expect(screen.getByText("Password-protected.")).toBeVisible()
  })

  it("shows how far a running file has got", () => {
    render(
      <TableList
        requestId="req_1"
        entries={[entry({ stage: "EXTRACTING", progress: { unit: "page", at: 2, of: 3 } })]}
      />,
    )
    expect(screen.getByText("page 2 of 3")).toBeVisible()
  })
})

describe("ConvertBar", () => {
  it("gates Convert on the server's answer and repeats its reason", () => {
    render(
      <ConvertBar
        readySchemaCount={34}
        convertAvailable={false}
        convertBlockedReason="7 files are still reading their shape."
        onReviewSchemas={vi.fn()}
        onConvert={vi.fn()}
      />,
    )
    expect(screen.getByText("7 files are still reading their shape.")).toBeVisible()
    expect(
      screen.getByRole("button", { name: /Convert.*7 files are still reading their shape/ }),
    ).toBeDisabled()
  })

  it("opens Review schemas as soon as any one shape is ready", () => {
    const { rerender } = render(
      <ConvertBar
        readySchemaCount={0}
        convertAvailable={false}
        convertBlockedReason="Nothing uploaded yet."
        onReviewSchemas={vi.fn()}
        onConvert={vi.fn()}
      />,
    )
    expect(screen.getByText("No schemas ready yet")).toBeVisible()

    rerender(
      <ConvertBar
        readySchemaCount={1}
        convertAvailable={false}
        convertBlockedReason="Nothing uploaded yet."
        onReviewSchemas={vi.fn()}
        onConvert={vi.fn()}
      />,
    )
    expect(screen.getByRole("button", { name: "Review schemas" })).toBeEnabled()
  })

  it("converts when the gate is met, and carries the count", async () => {
    const onConvert = vi.fn()
    const { user } = render(
      <ConvertBar
        readySchemaCount={41}
        convertAvailable
        convertBlockedReason={null}
        onReviewSchemas={vi.fn()}
        onConvert={onConvert}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Convert · 41" }))
    expect(onConvert).toHaveBeenCalledOnce()
  })

  it("re-states a refused gate rather than showing a generic error", () => {
    const { container } = render(
      <ConvertBar
        readySchemaCount={41}
        convertAvailable={false}
        convertBlockedReason="7 files are still reading their shape."
        failure={{ class: "gate_not_met", message: "7 files are still reading their shape." }}
        onReviewSchemas={vi.fn()}
        onConvert={vi.fn()}
      />,
    )
    expect(within(container).getAllByText("7 files are still reading their shape.")).toHaveLength(2)
    expect(screen.getByText("Wait for them to finish, or remove them.")).toBeVisible()
  })
})
