import { describe, expect, it, vi } from "vitest"
import { act, render, screen, waitFor } from "@/test/render"
import { ApiError } from "@/lib/api"
import { POLL_BACKOFF_AFTER_MS, POLL_FAST_MS, POLL_SLOW_MS, usePoll } from "./polling"

function Probe({
  poll,
  stopWhen,
  intervalFor,
  maxPolls,
}: {
  poll: (signal: AbortSignal) => Promise<string>
  stopWhen?: (data: string) => boolean
  intervalFor?: (data: string | null, elapsed: number) => number
  maxPolls?: number
}) {
  const { data, failure, settled, exhausted } = usePoll(poll, {
    stopWhen,
    intervalFor,
    maxPolls,
  })
  return (
    <div>
      <span data-testid="data">{data ?? "-"}</span>
      <span data-testid="failure">{failure?.class ?? "-"}</span>
      <span data-testid="settled">{String(settled)}</span>
      <span data-testid="exhausted">{String(exhausted)}</span>
    </div>
  )
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

describe("usePoll", () => {
  it("fires immediately rather than waiting out the first interval", async () => {
    const poll = vi.fn().mockResolvedValue("first")
    render(<Probe poll={poll} />)
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("first"))
    expect(poll).toHaveBeenCalledOnce()
  })

  it("polls every 2 s, then backs off to 5 s after a minute", async () => {
    vi.useFakeTimers()
    let n = 0
    const poll = vi.fn().mockImplementation(() => Promise.resolve(`poll ${(n += 1)}`))
    render(<Probe poll={poll} />)
    await flush()
    expect(poll).toHaveBeenCalledTimes(1)

    await tick(POLL_FAST_MS)
    expect(poll).toHaveBeenCalledTimes(2)

    // Run out the fast window, then check the next gap is the slow one.
    await tick(POLL_BACKOFF_AFTER_MS)
    const afterBackoff = poll.mock.calls.length
    await tick(POLL_FAST_MS)
    expect(poll).toHaveBeenCalledTimes(afterBackoff)
    await tick(POLL_SLOW_MS - POLL_FAST_MS)
    expect(poll).toHaveBeenCalledTimes(afterBackoff + 1)
  })

  it("stops when the stop predicate says so", async () => {
    vi.useFakeTimers()
    const poll = vi.fn().mockResolvedValue("done")
    render(<Probe poll={poll} stopWhen={(data) => data === "done"} />)
    await flush()
    await tick(POLL_FAST_MS * 5)
    expect(poll).toHaveBeenCalledOnce()
  })

  it("asks straight away, and holds the *next* one for as long as it is told", async () => {
    vi.useFakeTimers()
    const poll = vi.fn().mockResolvedValue("first")
    // A long gap between polls never delays the first: a freshly queued batch
    // has a full table list to show before any of it has been worked on.
    render(<Probe poll={poll} intervalFor={() => 120_000} />)
    await flush()

    expect(poll).toHaveBeenCalledOnce()
    expect(screen.getByTestId("settled")).toHaveTextContent("true")

    await tick(119_000)
    expect(poll).toHaveBeenCalledOnce()

    await tick(1_000)
    expect(poll).toHaveBeenCalledTimes(2)
  })

  it("gives up on a budget of polls, and says it gave up", async () => {
    vi.useFakeTimers()
    const poll = vi.fn().mockResolvedValue("still waiting")
    render(<Probe poll={poll} maxPolls={3} />)
    await flush()

    await tick(POLL_FAST_MS)
    await tick(POLL_FAST_MS)
    expect(poll).toHaveBeenCalledTimes(3)

    // Budget spent: no fourth poll, and the screen can tell it was given up on.
    await tick(POLL_FAST_MS * 5)
    expect(poll).toHaveBeenCalledTimes(3)
    expect(screen.getByTestId("exhausted")).toHaveTextContent("true")
  })

  it("keeps the last good state when a poll fails, and retries", async () => {
    vi.useFakeTimers()
    const poll = vi
      .fn()
      .mockResolvedValueOnce("good")
      .mockRejectedValueOnce(new ApiError({ class: "network" }, 0, null))
      .mockResolvedValue("good again")

    render(<Probe poll={poll} />)
    await flush()
    expect(screen.getByTestId("data")).toHaveTextContent("good")

    await tick(POLL_FAST_MS)
    expect(screen.getByTestId("failure")).toHaveTextContent("network")
    expect(screen.getByTestId("data")).toHaveTextContent("good")

    await tick(POLL_FAST_MS)
    expect(screen.getByTestId("data")).toHaveTextContent("good again")
    expect(screen.getByTestId("failure")).toHaveTextContent("-")
  })

  it("aborts what is in flight when the screen goes away", async () => {
    let captured: AbortSignal | null = null
    const poll = vi.fn().mockImplementation((signal: AbortSignal) => {
      captured = signal
      return new Promise<string>(() => {})
    })
    const { unmount } = render(<Probe poll={poll} />)
    await flush()
    unmount()
    expect(captured!.aborted).toBe(true)
  })

  it("lets a caller set its own cadence, which is how a pause polls at 30 s", async () => {
    vi.useFakeTimers()
    const poll = vi.fn().mockResolvedValue("paused")
    render(<Probe poll={poll} intervalFor={() => 30_000} />)
    await flush()
    await tick(POLL_FAST_MS)
    expect(poll).toHaveBeenCalledOnce()
    await tick(30_000)
    expect(poll).toHaveBeenCalledTimes(2)
  })
})
