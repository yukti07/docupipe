"use client"

import { useCallback } from "react"
import { api, FIXTURES } from "@/lib/api"
import type { ResultPollResponse } from "@/lib/api/types"
import { writeAllowance } from "@/lib/allowance"
import { usePoll, type PollState } from "@/lib/polling"
import { useAsync } from "@/lib/useAsync"

/**
 * The result cadence, pinned for now: nothing for the first two minutes,
 * because a batch that has just been queued has nothing to report yet, then
 * every 5 s for ten minutes. A paused batch keeps its own slower beat.
 *
 * On fixtures there is no worker to wait for, and two minutes of spinner is
 * two minutes of a screen that cannot be looked at. The cadence is the only
 * thing that changes; every state the screen can reach is still reachable.
 */
export const RESULT_FIRST_POLL_MS = FIXTURES ? 0 : 120_000
export const RESULT_POLL_MS = FIXTURES ? 1500 : 5000
export const RESULT_POLL_MAX = 120
export const PAUSED_POLL_MS = 30_000

export function useResultPolling(
  requestId: string,
  userId: string | null,
  options: {
    enabled?: boolean
    /** 0 for a batch this browser did not just convert — see the Converting screen. */
    initialDelayMs?: number
    onData?: (data: ResultPollResponse) => void
  } = {},
): PollState<ResultPollResponse> {
  const { enabled = true, initialDelayMs, onData } = options

  return usePoll<ResultPollResponse>(
    useCallback(
      (signal: AbortSignal) => api.pollResult(userId!, requestId, signal),
      [requestId, userId],
    ),
    {
      enabled: Boolean(userId) && enabled,
      stopWhen: (data) => data.status === "COMPLETED" || data.status === "FAILED",
      maxPolls: RESULT_POLL_MAX,
      initialDelayMs,
      intervalFor: (data) => (data?.status === "PAUSED" ? PAUSED_POLL_MS : RESULT_POLL_MS),
      onData: (data) => {
        // The header meter is on every screen, but the figure only arrives here.
        writeAllowance(data.allowance)
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
