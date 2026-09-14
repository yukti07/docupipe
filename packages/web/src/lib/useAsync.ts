"use client"

import { useCallback, useEffect, useState } from "react"
import { ApiError } from "@/lib/api"
import type { Failure } from "@/lib/api/types"

type Settled<T> = { key: string; attempt: number; data?: T; failure?: Failure }

export type AsyncState<T> = {
  data: T | null
  failure: Failure | null
  /** False until this key has settled, so a screen can say what it is waiting for. */
  settled: boolean
  reload: () => void
}

/**
 * One fetch, keyed by whatever identifies it. The result is only shown when it
 * belongs to the key being asked about now, so nothing is reset on the way in —
 * switching keys shows the new wait immediately without a render that throws
 * the last answer away first.
 */
export function useAsync<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
): AsyncState<T> {
  const [settled, setSettled] = useState<Settled<T> | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setSettled({ key, attempt, data })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setSettled({
          key,
          attempt,
          failure: error instanceof ApiError ? error.failure : { class: "unknown" },
        })
      })
    return () => controller.abort()
    // `load` is rebuilt on every render by most callers; the key is what
    // actually identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])

  const current = settled?.key === key && settled.attempt === attempt ? settled : null

  return {
    data: current?.data ?? null,
    failure: current?.failure ?? null,
    settled: current !== null,
    reload: useCallback(() => setAttempt((n) => n + 1), []),
  }
}
