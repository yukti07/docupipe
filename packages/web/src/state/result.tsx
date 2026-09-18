"use client"

import { useCallback } from "react"
import { api, FIXTURES } from "@/lib/api"
import type { ResultPollResponse } from "@/lib/api/types"
import { writeAllowance } from "@/lib/allowance"
import { writeCachedResult } from "@/lib/cache"
import { usePoll, type PollState } from "@/lib/polling"
import { useAsync } from "@/lib/useAsync"

/**
 * The result cadence: one poll immediately, then every 10 s through the first
 * two minutes, then every 5 s. A paused batch keeps its own slower beat.
 *
 * The first poll is immediate because the server can already answer it —
 * `pollResult` builds its entries from the schemas and calls anything without
 * a result row QUEUED, so a request queued one second ago comes back as the
 * whole table list, every row waiting. That is a screen. The two minutes after
 * it are slower because the worker has minutes of work before any of those
 * stages change, and asking faster through that only produces a run of
 * identical answers.
 *
 * On fixtures there is no worker to wait for, so there is nothing to wait out.
 * The cadence is the only thing that changes; every state the screen can reach
 * is still reachable.
 */
export const RESULT_WARMUP_MS = FIXTURES ? 0 : 120_000
export const RESULT_WARMUP_POLL_MS = FIXTURES ? 1500 : 10_000
export const RESULT_POLL_MS = FIXTURES ? 1500 : 5000
export const PAUSED_POLL_MS = 30_000

/** Twelve polls through the warm-up, then ten minutes of the steady beat. */
export const RESULT_POLL_MAX = 12 + 120

export function useResultPolling(
  requestId: string,
  userId: string | null,
  options: {
    enabled?: boolean
    /**
     * What is left of the warm-up, read fresh on every response. 0 for a batch
     * this browser did not just convert — see the Converting screen.
     */
    warmupMs?: number
    onData?: (data: ResultPollResponse) => void
  } = {},
): PollState<ResultPollResponse> {
  const { enabled = true, warmupMs = 0, onData } = options

  return usePoll<ResultPollResponse>(
    useCallback(
      (signal: AbortSignal) => api.pollResult(userId!, requestId, signal),
      [requestId, userId],
    ),
    {
      enabled: Boolean(userId) && enabled,
      stopWhen: (data) => data.status === "COMPLETED" || data.status === "FAILED",
      maxPolls: RESULT_POLL_MAX,
      // Read after every response, so the beat picks up by itself the moment
      // what is left of the warm-up runs out.
      intervalFor: (data) =>
        data?.status === "PAUSED"
          ? PAUSED_POLL_MS
          : warmupMs > 0
            ? RESULT_WARMUP_POLL_MS
            : RESULT_POLL_MS,
      onData: (data) => {
        // The header meter is on every screen, but the figure only arrives here.
        writeAllowance(data.allowance)
        // So leaving this batch for a table and coming back renders what the
        // screen already knew rather than waiting on a fresh poll.
        writeCachedResult(requestId, data)
        onData?.(data)
      },
    },
  )
}

/* ------------------------------------------------------------------ */
/* Which phase is this batch in?                                       */
/* ------------------------------------------------------------------ */

export type ConversionProbe = "unknown" | "not-started" | "started"

/**
 * The browser writes itself a note when Convert is pressed, but that note is
 * lost on a new machine and on cleared storage — and the server is the one that
 * actually knows. One result poll on load answers it: a request that has been
 * queued reports tables at stages, a request that has not reports nothing.
 */
export function useConversionProbe(requestId: string, userId: string | null): ConversionProbe {
  const { data, failure } = useAsync(
    userId ? `${userId}:${requestId}` : "",
    useCallback(
      (signal: AbortSignal) =>
        userId
          ? api.pollResult(userId, requestId, signal)
          : Promise.reject(new Error("no session yet")),
      [requestId, userId],
    ),
  )

  // A failed probe says nothing either way, so the note this browser holds stands.
  if (failure || !data) return "unknown"

  const queued =
    data.counts.queued +
    data.counts.extracting +
    data.counts.filling +
    data.counts.done +
    data.counts.failed

  return queued > 0 || data.files.length > 0 ? "started" : "not-started"
}
