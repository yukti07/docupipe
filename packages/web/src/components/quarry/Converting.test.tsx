import { describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@/test/render"
import type { ResultEntry, ResultPollResponse } from "@/lib/api/types"
import { ConvertBar } from "./ConvertBar"
import { PausedBanner } from "./PausedBanner"
import { PipelineStrip } from "./PipelineStrip"
import { StatusSentence, statusSentence } from "./StatusSentence"
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
})

describe("PipelineStrip", () => {
  const stageValue = (container: HTMLElement, key: string) =>
    container.querySelector(`[data-stage="${key}"] [data-count]`)?.textContent

  it("folds the worker's five stages into the three the batch actually does", () => {
    const counts = { queued: 19, extracting: 1, filling: 1, done: 18, failed: 2 }
    const { container } = render(<PipelineStrip counts={counts} detecting={4} />)

    // Queued, extracting and filling are one thing from the outside: a table
    // is being made. The stages are named for what is happening, not for the
    // worker's own vocabulary.
    expect(screen.getByText("Schema Detection")).toBeVisible()
    expect(screen.getByText("Data Processing")).toBeVisible()
    expect(screen.getByText("Done")).toBeVisible()
    expect(screen.queryByText("Queued")).not.toBeInTheDocument()
    expect(screen.queryByText("Extracting")).not.toBeInTheDocument()
    expect(screen.queryByText("Filling")).not.toBeInTheDocument()

    expect(stageValue(container, "detect")).toBe("4")
    expect(stageValue(container, "process")).toBe("21")
    expect(stageValue(container, "done")).toBe("20")
    expect(screen.getByText(/45 tables in total/)).toBeInTheDocument()
  })

  it("stands on Schema Detection before one table exists", () => {
    const { container } = render(
      <PipelineStrip
        counts={{ queued: 0, extracting: 0, filling: 0, done: 0, failed: 0 }}
        detecting={6}
      />,
    )
    expect(container.querySelectorAll("[data-active]")).toHaveLength(1)
    expect(container.querySelector('[data-stage="detect"]')).toHaveAttribute("data-active")
  })

  // The files still being read are a queue draining behind the work, not the
  // work: the batch is making tables from the moment it can make one.
  it("moves to Data Processing the moment any file has a shape", () => {
    const { container } = render(
      <PipelineStrip
        counts={{ queued: 2, extracting: 0, filling: 0, done: 0, failed: 0 }}
        detecting={4}
      />,
    )
    expect(container.querySelector('[data-stage="process"]')).toHaveAttribute("data-active")
    expect(container.querySelector('[data-stage="detect"]')).not.toHaveAttribute("data-active")
  })

  it("stands on Done only when nothing is left anywhere", () => {
    const { container } = render(
      <PipelineStrip counts={{ queued: 0, extracting: 0, filling: 0, done: 7, failed: 1 }} />,
    )
    expect(container.querySelector('[data-stage="done"]')).toHaveAttribute("data-active")
    expect(container.querySelectorAll("[data-active]")).toHaveLength(1)
  })

  // Three numbers is what the strip is for. "nothing waiting" beside a nought
  // is the nought again, in words and in small print.
  it("puts no small print under the two stages that are only ever a count", () => {
    const { container } = render(
      <PipelineStrip counts={{ queued: 2, extracting: 0, filling: 0, done: 3, failed: 0 }} detecting={1} />,
    )
    for (const key of ["detect", "process"]) {
      expect(container.querySelectorAll(`[data-stage="${key}"] p`)).toHaveLength(2)
    }
    expect(screen.queryByText(/nothing waiting|nothing running/)).not.toBeInTheDocument()
    expect(screen.queryByText(/reading the files|filling the tables/)).not.toBeInTheDocument()
  })

  it("names the failures under Done, in the error tone and nowhere else", () => {
    const { container } = render(
      <PipelineStrip counts={{ queued: 0, extracting: 0, filling: 0, done: 5, failed: 2 }} />,
    )
    const failed = screen.getByText("2 of them failed")
    expect(failed).toBeVisible()
    expect(failed.className).toContain("text-error-strong")
    // The count stays what it was: seven tables are finished with, five of
    // them usable. The line underneath is what says the difference.
    expect(container.querySelector('[data-stage="done"] [data-count]')).toHaveTextContent("7")
  })

  it("says nothing under Done when nothing failed", () => {
    const { container } = render(
      <PipelineStrip counts={{ queued: 0, extracting: 0, filling: 0, done: 3, failed: 0 }} />,
    )
    expect(container.querySelectorAll('[data-stage="done"] p')).toHaveLength(2)
    expect(screen.queryByText(/of them failed/)).not.toBeInTheDocument()
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
      "/request/req_1/table/sch_31",
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

  it("says Converting for every stage of the run, and never the worker's word for it", () => {
    render(
      <TableList
        requestId="req_1"
        entries={[
          entry({ schemaId: "sch_1", stage: "QUEUED" }),
          entry({ schemaId: "sch_2", stage: "EXTRACTING" }),
          entry({ schemaId: "sch_3", stage: "FILLING" }),
        ]}
      />,
    )
    expect(screen.getAllByText("Converting")).toHaveLength(3)
    expect(screen.queryByText("reading the pages")).not.toBeInTheDocument()
    expect(screen.queryByText("filling the table")).not.toBeInTheDocument()
  })

  it("names the files with no table yet, under the ones that have one", () => {
    render(
      <TableList
        requestId="req_1"
        entries={[entry({ fileName: "a.pdf", stage: "DONE", rowCount: 4 })]}
        awaiting={[{ fileId: "file_9", fileName: "z.pdf" }]}
      />,
    )
    expect(screen.getByText("Detecting")).toBeVisible()
    // Under, so a shape landing never pushes a row already being watched down.
    expect(screen.getAllByText(/\.pdf$/).map((el) => el.textContent)).toEqual(["a.pdf", "z.pdf"])
  })
})

describe("ConvertBar", () => {
  it("counts the bytes going up, and puts a bar of its own over them", () => {
    render(
      <ConvertBar
        convertAvailable={false}
        convertBlockedReason="2 files are still reading their shape."
        progress={{
          uploaded: 3,
          total: 3,
          schemas: 1,
          withoutShape: 0,
          uploading: false,
          inFlight: 0,
          fraction: 1,
        }}
        reviewHref="/request/req_test/schemas"
        onConvert={vi.fn()}
      />,
    )
    expect(screen.getByText("3 of 3 uploaded")).toBeVisible()
    // The count of shapes back used to sit under this line. Nothing on the
    // screen is gated on it any more, so it was a number nobody could act on.
    expect(screen.queryByText(/schemas back/)).not.toBeInTheDocument()
    expect(screen.getByRole("progressbar", { name: "Uploading this batch" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    )
  })

  it("counts what has landed, and says nothing about what is still moving", () => {
    render(
      <ConvertBar
        convertAvailable={false}
        convertBlockedReason={null}
        progress={{
          uploaded: 1,
          total: 3,
          schemas: 0,
          withoutShape: 0,
          uploading: true,
          inFlight: 1,
          fraction: 0.4,
        }}
        reviewHref="/request/req_test/schemas"
        onConvert={vi.fn()}
      />,
    )
    // The count of files whose bytes are in the air was beside this one. It
    // was a second number for the same thing the bar above already draws.
    expect(screen.getByText("1 of 3 uploaded")).toBeVisible()
    expect(screen.queryByText(/going up/)).not.toBeInTheDocument()
  })

  it("stops the spinner when the bytes stop, not when the shapes come back", () => {
    const landed = {
      uploaded: 3,
      total: 3,
      schemas: 0,
      withoutShape: 0,
      uploading: false,
      inFlight: 0,
      fraction: 1,
    }
    const { container } = render(
      <ConvertBar
        convertAvailable
        convertBlockedReason={null}
        progress={landed}
        reviewHref="/request/req_test/schemas"
        onConvert={vi.fn()}
      />,
    )
    // Not one shape is back, and nothing here waits for one: Review Schemas
    // opens on whatever has landed and Convert queues the rest.
    expect(container.querySelector("footer .animate-spin")).toBeNull()
    expect(screen.getByRole("link", { name: "Review Schemas" })).toBeVisible()
  })

  it("gates Convert on the server's answer and repeats its reason", () => {
    render(
      <ConvertBar
        convertAvailable={false}
        convertBlockedReason="7 files are still reading their shape."
        reviewHref="/request/req_test/schemas"
        onConvert={vi.fn()}
      />,
    )
    // The footer prints counts, not prose: the server's reason rides on the
    // disabled button, where it is read out with the control it explains.
    expect(screen.queryByText("7 files are still reading their shape.")).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Convert.*7 files are still reading their shape/ }),
    ).toBeDisabled()
  })

  // The review screen shows the shapes it has and a card per file it is still
  // reading, so opening it before any of them are back is a real screen.
  it("opens Review Schemas before a single shape is back", () => {
    render(
      <ConvertBar
        convertAvailable={false}
        convertBlockedReason="Nothing uploaded yet."
        reviewHref="/request/req_test/schemas"
        onConvert={vi.fn()}
      />,
    )
    // A real link, so the route is prefetched rather than fetched on the press.
    expect(screen.getByRole("link", { name: "Review Schemas" })).toHaveAttribute(
      "href",
      "/request/req_test/schemas",
    )
  })

  it("holds Review Schemas shut while bytes are still going up", () => {
    // Review is a route change, and the rows still uploading live only in the
    // screen it would leave — coming back rebuilds the list without them.
    render(
      <ConvertBar
        convertAvailable={false}
        convertBlockedReason="Nothing uploaded yet."
        progress={{
          uploaded: 1,
          total: 3,
          schemas: 1,
          withoutShape: 0,
          uploading: true,
          inFlight: 2,
          fraction: 0.4,
        }}
        reviewHref="/request/req_test/schemas"
        onConvert={vi.fn()}
      />,
    )
    expect(
      screen.getByRole("button", { name: /Review Schemas.*Wait for the uploads to finish/ }),
    ).toBeDisabled()
    expect(screen.queryByRole("link", { name: /Review Schemas/ })).not.toBeInTheDocument()
  })

  it("converts when the gate is met, and puts no count on the button", async () => {
    const onConvert = vi.fn()
    const { user } = render(
      <ConvertBar
        convertAvailable
        convertBlockedReason={null}
        reviewHref="/request/req_test/schemas"
        onConvert={onConvert}
      />,
    )
    // What is being converted is on the screen above the footer. A figure on
    // the button is only a second number to reconcile with it.
    await user.click(screen.getByRole("button", { name: "Convert" }))
    expect(onConvert).toHaveBeenCalledOnce()
  })

  it("re-states a refused gate rather than showing a generic error", () => {
    const { container } = render(
      <ConvertBar
        convertAvailable={false}
        convertBlockedReason="7 files are still reading their shape."
        failure={{ class: "gate_not_met", message: "7 files are still reading their shape." }}
        reviewHref="/request/req_test/schemas"
        onConvert={vi.fn()}
      />,
    )
    expect(within(container).getAllByText("7 files are still reading their shape.")).toHaveLength(1)
    expect(screen.getByText("Wait for them to finish, or remove them.")).toBeVisible()
  })
})
