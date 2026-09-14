"use client"

import { useCallback, useEffect, useEffectEvent, useState } from "react"
import { ApiError } from "@/lib/api"
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
  refresh: () => void
}

type PollOptions<T> = {
  /** Falsey stops the poll entirely — used before a userId exists. */
  enabled?: boolean
  /** Called with each response; returning true stops the loop. */
  stopWhen?: (data: T) => boolean
  /** Overrides the standard cadence, for the 30 s a PAUSED batch uses. */
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
  const { enabled = true, stopWhen, intervalFor, onData } = options

  const [data, setData] = useState<T | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [settled, setSettled] = useState(false)
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
      try {
        const next = await runPoll(controller.signal)
        if (!live) return
        latest = next
        setData(next)
        setFailure(null)
        setSettled(true)
        emit(next)
        if (shouldStop(next)) return
      } catch (error) {
        if (!live || controller.signal.aborted) return
        // The last good response stays on screen; the failure sits beside it.
        setFailure(error instanceof ApiError ? error.failure : { class: "unknown" })
        setSettled(true)
      }
      if (live) timer = setTimeout(run, wait())
    }

    void run()

    return () => {
      live = false
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [enabled, attempt])

  const refresh = useCallback(() => setAttempt((n) => n + 1), [])

  return { data, failure, settled, refresh }
}
