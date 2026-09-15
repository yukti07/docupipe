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
