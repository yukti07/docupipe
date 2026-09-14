import type { ResultPollResponse } from "@/lib/api/types"

const KEY = "quarry.allowance"

export type Allowance = ResultPollResponse["allowance"]

/**
 * The allowance only arrives on a result poll, but the meter is on every
 * screen. The last figure the server sent is kept so the header can show a
 * true-as-of number instead of inventing one — and shows nothing at all before
 * the first batch, rather than a made-up zero.
 */
export function readAllowance(): Allowance | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as Allowance).used === "number" &&
      typeof (parsed as Allowance).limit === "number"
    ) {
      return parsed as Allowance
    }
    return null
  } catch {
    return null
  }
}

export function writeAllowance(allowance: Allowance) {
  try {
    localStorage.setItem(KEY, JSON.stringify(allowance))
  } catch {
    // Losing the cached figure costs a meter, not a session.
  }
  listeners.forEach((listener) => listener())
}

/* ------------------------------------------------------------------ */
/* Read through an external store, so no screen sets state on mount     */
/* ------------------------------------------------------------------ */

const listeners = new Set<() => void>()
let raw: string | null = null
let cached: Allowance | null = null

export function subscribeAllowance(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Stable between writes, which is what useSyncExternalStore requires. */
export function allowanceSnapshot(): Allowance | null {
  let next: string | null = null
  try {
    next = localStorage.getItem(KEY)
  } catch {
    next = null
  }
  if (next === raw) return cached
  raw = next
  cached = readAllowance()
  return cached
}

/** There is nothing to remember on the server. */
export const allowanceServerSnapshot = (): Allowance | null => null
