"use client"

import { useCallback, useEffect, useEffectEvent, useRef } from "react"
import { api, FIXTURES } from "@/lib/api"
import type { ResultPollResponse } from "@/lib/api/types"
import { writeCachedResult } from "@/lib/cache"
import { usePoll, type PollState } from "@/lib/polling"
import { useAsync } from "@/lib/useAsync"
import type { WorkspaceBatch } from "@/state/workspace"

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

/* ------------------------------------------------------------------ */
/* One poll, for a card rather than a screen                           */
/* ------------------------------------------------------------------ */

/** What a result poll says about a batch, as the workspace records it. */
export function batchPatch(
  data: ResultPollResponse,
): Partial<Omit<WorkspaceBatch, "requestId">> {
  const toCheck = data.files.reduce((sum, file) => sum + (file.toCheckCount ?? 0), 0)
  return {
    // Counted from the server's own list, so a batch this browser has just
    // learned about gets a card that reads true. An empty list is not a count
    // of nought — it is a batch whose shapes have not come back yet — so the
    // number the card already has stands.
    ...(data.files.length > 0 ? { fileCount: data.files.length } : {}),
    phase:
      data.status === "PAUSED"
        ? "paused"
        : data.status === "COMPLETED"
          ? "done"
          : data.status === "FAILED"
            ? "failed"
            : "converting",
    summary: {
      tables: data.counts.done,
      rows: data.rowsSoFar,
      failed: data.counts.failed,
      toCheck,
      etaSeconds: data.estimatedSecondsRemaining,
      pausedUntil: data.pausedUntil,
    },
  }
}

/**
 * Catches the workspace up on the batches it last saw running.
 *
 * Every card in the list is a note this browser wrote, and the note is only
 * written while a batch screen is open and polling it. Close the results
 * screen before the last file lands — or close the tab — and the card goes on
 * saying Converting for a batch the server finished minutes ago, with the
 * counts it had at the moment you left.
 *
 * One poll per still-running batch, once per visit. Not a loop: the workspace
 * is a list of things you have already done, and a page that quietly re-asks
 * about six batches every few seconds is a different product.
 */
export function useWorkspaceRefresh(
  userId: string | null,
  batches: WorkspaceBatch[],
  onData: (requestId: string, data: ResultPollResponse) => void,
) {
  const asked = useRef(new Set<string>())
  // Whose batches are in `asked`. A `?w=` link swaps this browser's identity
  // and brings that identity's own cards with it, so ids asked under the one
  // before must not silence the ones that replaced them.
  const askedFor = useRef<string | null>(null)
  // The caller writes straight into the workspace, so its identity changes with
  // every card it updates. An effect that depended on it would chase its own
  // writes; this keeps the latest one without being a dependency.
  const deliver = useEffectEvent(onData)

  // A string, so the effect re-runs when a batch starts running and not on
  // every write the list happens to take.
  const running = batches
    .filter((batch) => batch.phase === "converting" || batch.phase === "paused")
    .map((batch) => batch.requestId)
    .sort()
    .join(",")

  useEffect(() => {
    if (!userId || !running) return
    if (askedFor.current !== userId) {
      asked.current.clear()
      askedFor.current = userId
    }
    let live = true

    for (const requestId of running.split(",")) {
      if (asked.current.has(requestId)) continue
      asked.current.add(requestId)
      void api
        .pollResult(userId, requestId)
        .then((data) => {
          if (live) deliver(requestId, data)
        })
        .catch(() => {
          // A card that cannot be refreshed keeps the note it already has,
          // which is the last thing that was true — and is asked about again
          // the next time the list settles, rather than being written off for
          // the life of the page.
          asked.current.delete(requestId)
        })
    }

    return () => {
      live = false
    }
  }, [running, userId])
}
