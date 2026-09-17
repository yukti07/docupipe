"use client"

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react"

/** There is no list-my-batches endpoint (§0.9), so the workspace list is client-local. */
export type WorkspacePhase = "prepare" | "converting" | "paused" | "done" | "failed"

export type WorkspaceBatch = {
  requestId: string
  name: string
  createdAt: string
  fileCount: number
  phase: WorkspacePhase
  /** When Convert was pressed *in this browser*. The result poll waits it out. */
  convertedAt?: string
  /** Last poll's headline numbers, so a card reads true before its first poll returns. */
  summary: {
    tables?: number
    rows?: number
    toCheck?: number
    failed?: number
    etaSeconds?: number | null
    pausedUntil?: string | null
  }
}

const KEY = "quarry.workspace"

/** Where a list waits while another identity is using this browser. */
const parked = (userId: string) => `${KEY}.${userId}`

/** Which parked ids exist, oldest-touched first — kept so eviction knows what to drop. */
const PARKED_ORDER_KEY = `${KEY}.parked-order`

/**
 * How many other identities' lists this browser keeps parked before forgetting
 * the oldest. Without a cap, a browser that opens many distinct `?w=` links —
 * every shared link is its own id — parks one more JSON blob forever, growing
 * toward the storage quota with nothing to ever reclaim it.
 */
const MAX_PARKED = 20

function parkedOrder(): string[] {
  try {
    const raw = localStorage.getItem(PARKED_ORDER_KEY)
    const value: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []
  } catch {
    return []
  }
}

/** Marks `id` as the most recently parked, evicting the oldest past MAX_PARKED. */
function touchParked(id: string) {
  const order = [...parkedOrder().filter((existing) => existing !== id), id]
  while (order.length > MAX_PARKED) {
    const oldest = order.shift()
    if (oldest) localStorage.removeItem(parked(oldest))
  }
  localStorage.setItem(PARKED_ORDER_KEY, JSON.stringify(order))
}

/** `id`'s list is live again, not parked — it drops out of the eviction order. */
function dropParked(id: string) {
  localStorage.setItem(
    PARKED_ORDER_KEY,
    JSON.stringify(parkedOrder().filter((existing) => existing !== id)),
  )
}

type WorkspaceValue = {
  batches: WorkspaceBatch[]
  /** False until the browser-held list has been read, so the page can say it is loading. */
  loaded: boolean
  addBatch: (batch: WorkspaceBatch) => void
  updateBatch: (requestId: string, patch: Partial<Omit<WorkspaceBatch, "requestId">>) => void
  removeBatch: (requestId: string) => void
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)

/* ------------------------------------------------------------------ */
/* The store — localStorage, read through useSyncExternalStore          */
/* ------------------------------------------------------------------ */

const listeners = new Set<() => void>()
/** Cached so getSnapshot returns a stable reference between writes. */
let snapshot: string | null = null
let parsed: WorkspaceBatch[] = []

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Another tab writing the same workspace is the same workspace.
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

const announce = () => listeners.forEach((listener) => listener())

function getSnapshot(): WorkspaceBatch[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    raw = null
  }
  if (raw === snapshot) return parsed
  snapshot = raw
  parsed = newestFirst(parse(raw))
  return parsed
}

/** localStorage does not exist on the server, so the list starts empty there. */
const EMPTY: WorkspaceBatch[] = []
const getServerSnapshot = () => EMPTY

function parse(raw: string | null): WorkspaceBatch[] {
  try {
    if (!raw) return []
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    // A corrupt entry loses that card, never the whole workspace.
    return value.filter(
      (b): b is WorkspaceBatch =>
        Boolean(b) && typeof b === "object" && typeof (b as WorkspaceBatch).requestId === "string",
    )
  } catch {
    return []
  }
}

const newestFirst = (batches: WorkspaceBatch[]) =>
  [...batches].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

/**
 * This browser changed hands — `?w=` adopted another identity, and the cards in
 * the list were made by the one before it.
 *
 * The outgoing list is parked under its own id rather than dropped, so the
 * `?w=` link back to that id brings exactly the same cards with it, and a list
 * parked under the incoming id is restored. Without this the new identity
 * inherits cards for requests the server holds no rows of, and every one of
 * them opens onto nothing.
 */
export function switchWorkspace(from: string | null, to: string) {
  // A list with no id behind it yet belongs to the first id this browser is
  // given, so there is nothing to move.
  if (!from || from === to) return
  try {
    const live = localStorage.getItem(KEY)
    if (live) {
      localStorage.setItem(parked(from), live)
      touchParked(from)
    }

    const theirs = localStorage.getItem(parked(to))
    if (theirs) {
      localStorage.setItem(KEY, theirs)
      localStorage.removeItem(parked(to))
      dropParked(to)
    } else {
      localStorage.removeItem(KEY)
    }
  } catch {
    // A blocked store costs the swap, not the session in front of you.
  }
  announce()
}

export function readWorkspace(): WorkspaceBatch[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    raw = null
  }
  return parse(raw)
}

function write(batches: WorkspaceBatch[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(newestFirst(batches)))
  } catch {
    // A full or blocked store loses persistence, not the session in front of you.
  }
  announce()
}

/* ------------------------------------------------------------------ */

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const batches = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )

  const value = useMemo<WorkspaceValue>(
    () => ({
      batches,
      loaded: hydrated,
      addBatch: (batch) =>
        write([...readWorkspace().filter((b) => b.requestId !== batch.requestId), batch]),
      // Upserts. A workspace link opened on another machine lands straight on a
      // batch this browser has never heard of; learning about it from the
      // server is how it appears in the list at all.
      updateBatch: (requestId, patch) => {
        const current = readWorkspace()
        if (!current.some((b) => b.requestId === requestId)) {
          write([
            ...current,
            {
              requestId,
              name: patch.name ?? `Batch ${requestId.replace(/^req_/, "").slice(0, 6)}`,
              createdAt: patch.createdAt ?? new Date().toISOString(),
              fileCount: patch.fileCount ?? 0,
              phase: patch.phase ?? "converting",
              summary: patch.summary ?? {},
            },
          ])
          return
        }
        write(
          current.map((b) =>
            b.requestId === requestId
              ? { ...b, ...patch, summary: { ...b.summary, ...patch.summary } }
              : b,
          ),
        )
      },
      removeBatch: (requestId) => write(readWorkspace().filter((b) => b.requestId !== requestId)),
    }),
    [batches, hydrated],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error("useWorkspace must be used inside a WorkspaceProvider")
  return value
}
