import { describe, expect, it, vi } from "vitest"
import { act, render } from "@/test/render"
import { api } from "@/lib/api"
import type { ResultPollResponse } from "@/lib/api/types"
import { readCachedResult } from "@/lib/cache"
import {
  batchPatch,
  PAUSED_POLL_MS,
  RESULT_POLL_MS,
  RESULT_WARMUP_MS,
  RESULT_WARMUP_POLL_MS,
  useResultPolling,
} from "./result"

const response = (over: Partial<ResultPollResponse> = {}): ResultPollResponse => ({
  userId: "usr_1",
  requestId: "req_1",
  status: "CONVERTING",
  pausedUntil: null,
  counts: { queued: 2, extracting: 0, filling: 0, done: 0, failed: 0 },
  rowsSoFar: 0,
  estimatedSecondsRemaining: null,
  allowance: { used: 0, limit: 5000, resetsAt: "2026-09-15T00:00:00Z" },
  files: [],
  ...over,
})

function Probe({ warmupMs }: { warmupMs: number }) {
  useResultPolling("req_1", "usr_1", { warmupMs })
  return null
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const tick = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
  await flush()
}

describe("useResultPolling", () => {
  it("asks straight away, then every 10 s through the warm-up", async () => {
    vi.useFakeTimers()
    const poll = vi.spyOn(api, "pollResult").mockResolvedValue(response())

    render(<Probe warmupMs={RESULT_WARMUP_MS} />)
    await flush()
    expect(poll).toHaveBeenCalledOnce()

    // Not at the steady beat — the worker has minutes of work before any of
    // these stages change, and asking twice as often only repeats the answer.
    await tick(RESULT_POLL_MS)
    expect(poll).toHaveBeenCalledOnce()

    await tick(RESULT_WARMUP_POLL_MS - RESULT_POLL_MS)
    expect(poll).toHaveBeenCalledTimes(2)
  })

  it("picks up to every 5 s once the warm-up has run out", async () => {
    vi.useFakeTimers()
    const poll = vi.spyOn(api, "pollResult").mockResolvedValue(response())

    render(<Probe warmupMs={0} />)
    await flush()

    await tick(RESULT_POLL_MS)
    expect(poll).toHaveBeenCalledTimes(2)
    await tick(RESULT_POLL_MS)
    expect(poll).toHaveBeenCalledTimes(3)
  })

  it("drops to its own slow beat while the batch is paused", async () => {
    vi.useFakeTimers()
    const poll = vi.spyOn(api, "pollResult").mockResolvedValue(response({ status: "PAUSED" }))

    render(<Probe warmupMs={0} />)
    await flush()

    await tick(RESULT_POLL_MS)
    expect(poll).toHaveBeenCalledOnce()
    await tick(PAUSED_POLL_MS - RESULT_POLL_MS)
    expect(poll).toHaveBeenCalledTimes(2)
  })

  it("stops for good once the batch has finished", async () => {
    vi.useFakeTimers()
    const poll = vi.spyOn(api, "pollResult").mockResolvedValue(response({ status: "COMPLETED" }))

    render(<Probe warmupMs={0} />)
    await flush()
    await tick(RESULT_POLL_MS * 4)
    expect(poll).toHaveBeenCalledOnce()
  })

  it("keeps the last answer, so coming back to this batch has something to render", async () => {
    vi.spyOn(api, "pollResult").mockResolvedValue(response({ rowsSoFar: 41 }))

    render(<Probe warmupMs={0} />)
    await flush()

    expect(readCachedResult("req_1")?.rowsSoFar).toBe(41)
  })
})

describe("batchPatch", () => {
  it("does not touch the file count — `files` is one entry per TABLE", () => {
    // One three-sheet workbook comes back as three entries. Writing that into
    // fileCount made the card read "3 files" for a single dropped file.
    const data = response({
      status: "COMPLETED",
      counts: { queued: 0, extracting: 0, filling: 0, done: 3, failed: 0 },
      files: [
        { fileId: "f_1", fileName: "books.xlsx", schemaId: "sch_0", stage: "DONE", rowCount: 5 },
        { fileId: "f_1", fileName: "books.xlsx", schemaId: "sch_1", stage: "DONE", rowCount: 7 },
        { fileId: "f_1", fileName: "books.xlsx", schemaId: "sch_2", stage: "DONE", rowCount: 2 },
      ],
    })

    expect(batchPatch(data)).not.toHaveProperty("fileCount")
  })

  it("still reports the tables, the rows and the phase", () => {
    const data = response({
      status: "COMPLETED",
      counts: { queued: 0, extracting: 0, filling: 0, done: 3, failed: 1 },
      rowsSoFar: 14,
    })
    const patch = batchPatch(data)

    expect(patch.phase).toBe("done")
    expect(patch.summary?.tables).toBe(3)
    expect(patch.summary?.rows).toBe(14)
    expect(patch.summary?.failed).toBe(1)
  })
})
