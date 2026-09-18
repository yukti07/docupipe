import type { ResultPollResponse, TableData } from "@/lib/api/types"

/**
 * Answers this browser has already been given, kept so returning to a screen
 * does not re-ask for them.
 *
 * Only for data that is settled where it is read: a finished table's rows never
 * change, and the last thing a result poll said is the truest thing available
 * until the next one lands. A miss is always safe — every caller falls back to
 * asking, so a blocked or full store costs a round trip and nothing else.
 *
 * What it holds is capped, and what it reads back is checked. Both matter more
 * here than they look: this store is shared with the workspace list, the
 * allowance meter and the per-batch file map, all of which fail silently when
 * the quota runs out — so a cache that grew without limit would not break
 * itself, it would quietly stop the batch list persisting.
 */

const ORDER_KEY = "quarry.cache.order"

/** Per entry. A table past this is left uncached rather than crowding out the rest. */
const MAX_CHARS = 1_000_000

/** Across every entry, leaving the other writers room inside the ~5MB an origin gets. */
const MAX_TOTAL_CHARS = 2_000_000

const base = (requestId: string) => `quarry.cache.${requestId}`
const resultKey = (requestId: string) => `${base(requestId)}.result`
const tableKey = (requestId: string, schemaId: string) => `${base(requestId)}.table.${schemaId}`

/* ------------------------------------------------------------------ */
/* What is held, oldest first — so eviction knows what to drop          */
/* ------------------------------------------------------------------ */

type Entry = { key: string; chars: number }

function order(): Entry[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    const value: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(value)) return []
    return value.filter(
      (entry): entry is Entry =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as Entry).key === "string" &&
        typeof (entry as Entry).chars === "number",
    )
  } catch {
    return []
  }
}

/** Newest last, and the oldest dropped until what is held fits the budget. */
function remember(key: string, chars: number) {
  const kept = order().filter((entry) => entry.key !== key)
  kept.push({ key, chars })

  let total = kept.reduce((sum, entry) => sum + entry.chars, 0)
  // The entry just written is last, so it is the one thing never evicted —
  // caching something and immediately dropping it would be worse than not
  // caching it at all.
  while (total > MAX_TOTAL_CHARS && kept.length > 1) {
    const oldest = kept.shift()!
    localStorage.removeItem(oldest.key)
    total -= oldest.chars
  }

  localStorage.setItem(ORDER_KEY, JSON.stringify(kept))
}

function forget(key: string) {
  try {
    localStorage.removeItem(key)
    localStorage.setItem(ORDER_KEY, JSON.stringify(order().filter((entry) => entry.key !== key)))
  } catch {
    // Nothing to do; the cache is a convenience.
  }
}

/** Everything held for a batch that is going away, so a discarded batch leaves nothing behind. */
export function forgetCached(requestId: string) {
  const prefix = `${base(requestId)}.`
  try {
    const kept: Entry[] = []
    for (const entry of order()) {
      if (entry.key.startsWith(prefix)) localStorage.removeItem(entry.key)
      else kept.push(entry)
    }
    localStorage.setItem(ORDER_KEY, JSON.stringify(kept))
  } catch {
    // Nothing to do; the cache is a convenience.
  }
}

/* ------------------------------------------------------------------ */

function read<T>(key: string, valid: (value: unknown) => value is T): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (valid(value)) return value
    // Written by a build that shaped this differently. Dropped rather than left
    // for every later load to trip over in the same way.
    forget(key)
    return null
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try {
    const text = JSON.stringify(value)
    if (text.length > MAX_CHARS) return
    localStorage.setItem(key, text)
    remember(key, text.length)
  } catch {
    // A full or blocked store costs a re-fetch, nothing more.
  }
}

/* ------------------------------------------------------------------ */
/* The two surfaces, each checked for what its screen dereferences      */
/* ------------------------------------------------------------------ */

function isResult(value: unknown): value is ResultPollResponse {
  if (!value || typeof value !== "object") return false
  const result = value as ResultPollResponse
  const counts = result.counts as Record<string, unknown> | undefined
  return (
    typeof result.status === "string" &&
    typeof result.rowsSoFar === "number" &&
    Array.isArray(result.files) &&
    Boolean(counts) &&
    typeof counts === "object" &&
    (["queued", "extracting", "filling", "done", "failed"] as const).every(
      (stage) => typeof counts[stage] === "number",
    )
  )
}

function isTable(value: unknown): value is TableData {
  if (!value || typeof value !== "object") return false
  const table = value as TableData
  return (
    typeof table.fileName === "string" &&
    Array.isArray(table.fields) &&
    Array.isArray(table.rows)
  )
}

export const readCachedResult = (requestId: string) => read(resultKey(requestId), isResult)

export const writeCachedResult = (requestId: string, result: ResultPollResponse) =>
  write(resultKey(requestId), result)

export const readCachedTable = (requestId: string, schemaId: string) =>
  read(tableKey(requestId, schemaId), isTable)

export const writeCachedTable = (requestId: string, schemaId: string, table: TableData) =>
  write(tableKey(requestId, schemaId), table)
