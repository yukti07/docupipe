"use client"

import { useCallback, useEffect, useEffectEvent, useState } from "react"
import { toFailure } from "@/lib/api"
import type { Failure } from "@/lib/api/types"

/** §0.4 and §0.7: every 2 s, backing off to 5 s after a minute of waiting. */
export const POLL_FAST_MS = 2000
export const POLL_SLOW_MS = 5000
export const POLL_BACKOFF_AFTER_MS = 60_000

export type PollState<T> = {
  /** The last good response. A failed poll never clears it. */
  data: T | null
  /** Present while a poll is failing; cleared the moment one succeeds. */
  failure: Failure | null
  /** True once a first response — good or bad — has come back. */
  settled: boolean
  /** True when the loop gave up on its budget of polls rather than finishing. */
  exhausted: boolean
  /** True when the loop is no longer running — settled, or out of budget. */
  stopped: boolean
  refresh: () => void
}

type PollOptions<T> = {
  /** Falsey stops the poll entirely — used before a userId exists. */
  enabled?: boolean
  /** Called with each response; returning true stops the loop. */
  stopWhen?: (data: T) => boolean
  /** A budget, so a server that never settles cannot poll forever. */
  maxPolls?: number
  /**
   * Overrides the standard cadence — the 30 s a PAUSED batch uses, and the
   * long first gap a freshly queued one takes.
   *
   * Called after each response, so a caller that returns what is left of a
   * deadline gets the current remainder every time rather than a figure fixed
   * when the loop was set up.
   */
  intervalFor?: (data: T | null, elapsedMs: number) => number
  onData?: (data: T) => void
}

/**
 * One poll loop, shared by the schema poll and the result poll. Fires
 * immediately, then on the interval; aborts what is in flight on unmount; and
 * keeps the last good state when a poll fails, because a dropped connection is
 * not a reason to blank a screen the user is reading.
 */
export function usePoll<T>(
  poll: (signal: AbortSignal) => Promise<T>,
  options: PollOptions<T> = {},
): PollState<T> {
  const { enabled = true, stopWhen, maxPolls, intervalFor, onData } = options

  const [data, setData] = useState<T | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  // Which attempt got a first response, which ran out of budget, and which one
  // stopped, so a refresh clears all three without a synchronous reset on the
  // way into the effect — a raw boolean here would stay true across a refresh,
  // since nothing but a new response would ever flip it back.
  const [settledAt, setSettledAt] = useState<number | null>(null)
  const [exhaustedAt, setExhaustedAt] = useState<number | null>(null)
  const [stoppedAt, setStoppedAt] = useState<number | null>(null)
  const [attempt, setAttempt] = useState(0)

  // Effect events, so a new closure identity on any of these never restarts the
  // loop — and the loop always calls the current one.
  const runPoll = useEffectEvent((signal: AbortSignal) => poll(signal))
  const shouldStop = useEffectEvent((data: T) => stopWhen?.(data) ?? false)
  const intervalOf = useEffectEvent((data: T | null, elapsed: number) =>
    intervalFor?.(data, elapsed),
  )
  const emit = useEffectEvent((data: T) => onData?.(data))

  useEffect(() => {
    if (!enabled) return

    let live = true
    let polls = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    const startedAt = Date.now()
    let latest: T | null = null

    const wait = () => {
      const elapsed = Date.now() - startedAt
      const standard = elapsed >= POLL_BACKOFF_AFTER_MS ? POLL_SLOW_MS : POLL_FAST_MS
      return intervalOf(latest, elapsed) ?? standard
    }

    async function run() {
      polls += 1
      try {
        const next = await runPoll(controller.signal)
        if (!live) return
        latest = next
        setData(next)
        setFailure(null)
        setSettledAt(attempt)
        emit(next)
        if (shouldStop(next)) {
          setStoppedAt(attempt)
          return
        }
      } catch (error) {
        if (!live || controller.signal.aborted) return
        // The last good response stays on screen; the failure sits beside it.
        setFailure(toFailure(error))
        setSettledAt(attempt)
      }
      if (!live) return
      // Out of budget. The screen has to say so rather than spin on quietly.
      if (maxPolls !== undefined && polls >= maxPolls) {
        setExhaustedAt(attempt)
        setStoppedAt(attempt)
        return
      }
      timer = setTimeout(run, wait())
    }

    // Always asked straight away. Work that takes minutes still has something
    // true to say the moment it is queued, and a caller that wants to wait
    // before asking *again* says so through `intervalFor`.
    void run()

    return () => {
      live = false
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [enabled, attempt, maxPolls])

  const refresh = useCallback(() => setAttempt((n) => n + 1), [])

  return {
    data,
    failure,
    settled: settledAt === attempt,
    exhausted: exhaustedAt === attempt,
    stopped: stoppedAt === attempt,
    refresh,
  }
}
