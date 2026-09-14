"use client"

import { useCallback } from "react"
import { api } from "@/lib/api"
import type { ResultPollResponse } from "@/lib/api/types"
import { writeAllowance } from "@/lib/allowance"
import { usePoll, type PollState } from "@/lib/polling"
import { useAsync } from "@/lib/useAsync"

/** §0.7's cadence: 2 s while converting, 30 s while paused, stop when it ends. */
export const PAUSED_POLL_MS = 30_000

export function useResultPolling(
  requestId: string,
  userId: string | null,
  options: { enabled?: boolean; onData?: (data: ResultPollResponse) => void } = {},
): PollState<ResultPollResponse> {
  const { enabled = true, onData } = options

  return usePoll<ResultPollResponse>(
    useCallback(
      (signal: AbortSignal) => api.pollResult(userId!, requestId, signal),
      [requestId, userId],
    ),
    {
      enabled: Boolean(userId) && enabled,
      stopWhen: (data) => data.status === "COMPLETED" || data.status === "FAILED",
      intervalFor: (data) => (data?.status === "PAUSED" ? PAUSED_POLL_MS : 2000),
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
