import schemaPollFixture from "@fixtures/api/schema-poll.json"
import { FIXTURE_UPLOAD_URL } from "@/lib/upload"
import type { QuarryApi } from "./contract"
import type * as T from "./types"

/**
 * The seven live routes, served from fixtures — the whole app with no server,
 * no Postgres and no worker behind it. Switched on by NEXT_PUBLIC_FIXTURES=1;
 * see `index.ts`, which is the only place that decides.
 *
 * It is a state machine, not a canned reply. Shapes arrive over several polls,
 * Convert actually gates on them, and tables finish one after another, because
 * a screen that only ever shows its settled state hides most of what it does.
 *
 * Two sources of files:
 *
 *   - Files dropped in this browser. `getSignedUrls` mints ids for them and
 *     everything after is built around those ids, so the rows you dropped are
 *     the rows that come back.
 *   - Nothing dropped — a link opened cold. Then the canned 43-entry payload
 *     from `fixtures/api/schema-poll.json` stands in, which is the only way to
 *     see the dense end of this screen without dropping 43 files.
 */

/** Enough delay that a loading state is exercised in development rather than skipped. */
const DELAY_MS = 140

/** Polls before every shape is back, and before every table has converted. */
const SCHEMA_POLLS_TO_SETTLE = 3
const RESULT_POLLS_TO_SETTLE = 6

function later<V>(value: V, ms = DELAY_MS): Promise<V> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

/** Deterministic from the id, so a file reports the same numbers on every poll. */
function seededInt(seed: string, mod: number): number {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash) % mod
}

/* ------------------------------------------------------------------ */
/* The two shapes, lifted from the canned payload                      */
/* ------------------------------------------------------------------ */

const CANNED = schemaPollFixture as unknown as T.SchemaPollResponse

const template = (shapeHash: string): T.TableSchema =>
  CANNED.files.find((f) => f.schema?.shapeHash === shapeHash)!.schema!

const TOTALS = template("9c1f2a7e")
const LINES = template("4b7e0d31")

/* ------------------------------------------------------------------ */
/* Per-request state                                                   */
/* ------------------------------------------------------------------ */

type Uploaded = { fileId: string; fileName: string }

type RequestState = {
  /** What getSignedUrls handed out, in the order it was asked. */
  uploaded: Uploaded[]
  /** Built once from `uploaded`, or from the canned payload when it is empty. */
  entries: T.SchemaEntry[] | null
  /** How many files `entries` was built for, so adding more rebuilds it. */
  entriesFor: number
  schemaPolls: number
  resultPolls: number
  converted: boolean
  versions: Record<string, number>
}

const STORE_KEY = "quarry:fixtures:v1"

const requests = new Map<string, RequestState>()
let loaded = false

/**
 * Kept in sessionStorage so a reload lands back where it was. Without it a
 * refresh on a converting batch would find a fixture that had forgotten the
 * batch was ever converted, and report zero of everything.
 */
function load(): void {
  if (loaded || typeof window === "undefined") return
  loaded = true
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    if (!raw) return
    for (const [id, state] of Object.entries(JSON.parse(raw) as Record<string, RequestState>)) {
      requests.set(id, state)
    }
  } catch {
    // A fixture is not worth a crash. A fresh start is a fine fallback.
  }
}

function save(): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(requests)))
  } catch {
    // Quota, or a private window. The screen still works; only the reload is lost.
  }
}

function stateFor(requestId: string): RequestState {
  load()
  const existing = requests.get(requestId)
  if (existing) return existing
  const fresh: RequestState = {
    uploaded: [],
    entries: null,
    entriesFor: -1,
    schemaPolls: 0,
    resultPolls: 0,
    converted: false,
    versions: {},
  }
  requests.set(requestId, fresh)
  return fresh
}

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

function ownEntries(requestId: string, file: Uploaded, index: number): T.SchemaEntry[] {
  const base = {
    fileId: file.fileId,
    fileName: file.fileName,
    filePath: `requests/${requestId}/input/${file.fileId}-${file.fileName}`,
  }

  // Every seventh file settles without a shape, so the "won't convert" panel is
  // on screen in any drop big enough to have one.
  if (index % 7 === 6) {
    return [
      {
        ...base,
        schemaId: null,
        status: "failed",
        schema: null,
        failure: {
          class: "extract_empty",
          message: "Its pages are images with no readable text.",
          nextStep: "Remove it, or convert it anyway and it will be skipped.",
        },
      },
    ]
  }

  // Every ninth holds two tables, which is the only way to reach the tabbed panel.
  const multi = index % 9 === 8

  const first: T.SchemaEntry = {
    ...base,
    schemaId: `sch_${file.fileId}_0`,
    status: "ready",
    schema: {
      ...TOTALS,
      tableOrd: 0,
      tableLabel: multi ? "Sheet 1 · Totals" : "table 1",
      version: 1,
      matchingFileCount: 0,
    },
  }
  if (!multi) return [first]

  return [
    first,
    {
      ...base,
      schemaId: `sch_${file.fileId}_1`,
      status: "ready",
      schema: {
        ...LINES,
        tableOrd: 1,
        tableLabel: "Sheet 2 · Line items",
        version: 1,
        matchingFileCount: 0,
      },
    },
  ]
}

function entriesFor(state: RequestState, requestId: string): T.SchemaEntry[] {
  if (state.entries && state.entriesFor === state.uploaded.length) return state.entries

  const built =
    state.uploaded.length > 0
      ? state.uploaded.flatMap((file, index) => ownEntries(requestId, file, index))
      : CANNED.files

  // "Shared with N" and apply-to-all both read this, so it has to be counted
  // across the batch rather than guessed per file.
  const perShape = new Map<string, number>()
  for (const entry of built) {
    if (!entry.schema) continue
    perShape.set(entry.schema.shapeHash, (perShape.get(entry.schema.shapeHash) ?? 0) + 1)
  }

  state.entries = built.map((entry) =>
    entry.schema
      ? {
          ...entry,
          schema: {
            ...entry.schema,
            matchingFileCount: perShape.get(entry.schema.shapeHash) ?? 1,
          },
        }
      : entry,
  )
  state.entriesFor = state.uploaded.length
  return state.entries
}

/**
 * A file arrives whole, with every table it holds. The client de-duplicates the
 * delta by fileId, so splitting one file's tables across two polls would lose
 * all but the first — and a real server has the same constraint.
 */
function byFile(entries: T.SchemaEntry[]): T.SchemaEntry[][] {
  const order: string[] = []
  const groups = new Map<string, T.SchemaEntry[]>()
  for (const entry of entries) {
    const group = groups.get(entry.fileId)
    if (group) {
      group.push(entry)
      continue
    }
    groups.set(entry.fileId, [entry])
    order.push(entry.fileId)
  }
  return order.map((fileId) => groups.get(fileId)!)
}

const revealed = (polls: number, total: number, over: number) =>
  Math.min(total, Math.max(1, Math.ceil((total * polls) / over)))

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

const allowanceFor = (rows: number): T.ResultPollResponse["allowance"] => ({
  used: 1840 + rows,
  limit: 5000,
  resetsAt: new Date(Date.now() + 86_400_000).toISOString(),
})

/** Nothing queued: what the server says about a request that has not converted. */
function idleResult(userId: string, requestId: string): T.ResultPollResponse {
  return {
    userId,
    requestId,
    status: "CONVERTING",
    pausedUntil: null,
    counts: { queued: 0, extracting: 0, filling: 0, done: 0, failed: 0 },
    rowsSoFar: 0,
    estimatedSecondsRemaining: null,
    allowance: allowanceFor(0),
    files: [],
  }
}

function resultFor(state: RequestState, userId: string, requestId: string): T.ResultPollResponse {
  const ready = entriesFor(state, requestId).filter(
    (entry): entry is T.SchemaEntry & { schemaId: string } =>
      entry.status === "ready" && entry.schemaId !== null,
  )

  const settled = revealed(state.resultPolls, ready.length, RESULT_POLLS_TO_SETTLE)
  const counts = { queued: 0, extracting: 0, filling: 0, done: 0, failed: 0 }
  let rowsSoFar = 0

  const files: T.ResultEntry[] = ready.map((entry, index) => {
    const base = {
      fileId: entry.fileId,
      fileName: entry.fileName,
      schemaId: entry.schemaId,
      fieldCount: entry.schema?.fields.length ?? 6,
    }

    if (index < settled) {
      // Every eleventh table fails in the worker rather than at inference — a
      // different row, and different copy, from a file with no shape at all.
      if (index % 11 === 10) {
        counts.failed += 1
        return {
          ...base,
          stage: "FAILED",
          failure: {
            class: "response_unparseable",
            message: "The model's answer for this file did not parse.",
            nextStep: "Convert it again on its own.",
          },
        }
      }
      const rowCount = 6 + seededInt(entry.schemaId, 25)
      counts.done += 1
      rowsSoFar += rowCount
      return {
        ...base,
        stage: "DONE",
        rowCount,
        toCheckCount: index % 5 === 1 ? 1 + seededInt(`${entry.schemaId}:check`, 3) : 0,
      }
    }

    if (index === settled) {
      counts.extracting += 1
      const of = 3 + seededInt(`${entry.schemaId}:pages`, 9)
      return {
        ...base,
        stage: "EXTRACTING",
        progress: { unit: "page", at: 1 + (state.resultPolls % of), of },
      }
    }

    if (index === settled + 1) {
      counts.filling += 1
      return { ...base, stage: "FILLING" }
    }

    counts.queued += 1
    return { ...base, stage: "QUEUED" }
  })

  const finished = settled >= ready.length
  const left = ready.length - settled

  return {
    userId,
    requestId,
    status: finished ? "COMPLETED" : "CONVERTING",
    pausedUntil: null,
    counts,
    rowsSoFar,
    estimatedSecondsRemaining: finished ? null : left * 20,
    allowance: allowanceFor(rowsSoFar),
    files,
  }
}

/* ------------------------------------------------------------------ */

export const FixtureSeven: Pick<
  QuarryApi,
  | "register"
  | "getSignedUrls"
  | "confirmUploads"
  | "pollSchemas"
  | "updateSchemas"
  | "convert"
  | "pollResult"
  | "discardFiles"
> = {
  register: () => later<T.RegisterResponse>({ status: "ok" }),

  getSignedUrls: (userId, requestId, fileNames) => {
    const state = stateFor(requestId)

    // Keyed by name, so a retry re-signs the same file rather than minting a
    // second id for it and doubling the row on the next poll.
    const files: T.SignedUrlFile[] = fileNames.map((fileName) => {
      let known = state.uploaded.find((f) => f.fileName === fileName)
      if (!known) {
        known = { fileId: `file_fx_${state.uploaded.length}`, fileName }
        state.uploaded.push(known)
      }
      return {
        fileId: known.fileId,
        fileName,
        filePath: `${FIXTURE_UPLOAD_URL}${known.fileId}`,
        uploadHeaders: { "Content-Type": "application/octet-stream" },
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }
    })

    save()
    return later<T.SignedUrlResponse>({ userId, requestId, files })
  },

  confirmUploads: (_userId, _requestId, files) =>
    later<T.UploadResponse>({
      status: "ok",
      files: files.map((file) => ({ fileId: file.fileId, stage: "UPLOADED" as const })),
    }),

  pollSchemas: (userId, requestId, received) => {
    const state = stateFor(requestId)
    state.schemaPolls += 1

    const groups = byFile(entriesFor(state, requestId))
    const back = revealed(state.schemaPolls, groups.length, SCHEMA_POLLS_TO_SETTLE)
    const pending = groups.length - back
    const seen = new Set(received)

    save()
    return later<T.SchemaPollResponse>({
      userId,
      requestId,
      pending,
      // The gate is arrival, not inspection — the same rule the server applies.
      convertAvailable: pending === 0,
      convertBlockedReason:
        pending === 0
          ? null
          : `${pending} ${pending === 1 ? "file is" : "files are"} still being read`,
      files: groups
        .slice(0, back)
        .filter((group) => !seen.has(group[0].fileId))
        .flat(),
    })
  },

  updateSchemas: (_userId, requestId, files) => {
    const state = stateFor(requestId)
    const entries = entriesFor(state, requestId)

    const updated = files.map((file) => {
      const version = (state.versions[file.schemaId] ?? 1) + 1
      state.versions[file.schemaId] = version

      // Held, so a reload reads back what was saved instead of the shape the
      // document originally gave.
      const entry = entries.find((e) => e.schemaId === file.schemaId)
      if (entry?.schema) {
        entry.schema = { ...entry.schema, fields: file.schema.fields, version }
      }
      return { schemaId: file.schemaId, version }
    })

    save()
    return later<T.UpdateSchemaResponse>({ status: "ok", updated })
  },

  convert: (_userId, requestId) => {
    const state = stateFor(requestId)
    const entries = entriesFor(state, requestId)
    state.converted = true
    state.resultPolls = 0
    save()

    return later<T.ConvertResponse>({
      status: "received",
      queued: entries.filter((e) => e.status === "ready").length,
      skipped: entries.filter((e) => e.status === "failed").length,
    })
  },

  pollResult: (userId, requestId) => {
    const state = stateFor(requestId)
    if (!state.converted) return later(idleResult(userId, requestId))

    state.resultPolls += 1
    save()
    return later(resultFor(state, userId, requestId))
  },

  // Really removes them, so `remaining` is the truth rather than a guess: the
  // screen closes an emptied batch on that number, and a fixture that always
  // said nought would send every discard back to the workspace.
  discardFiles: (_userId, requestId, fileIds) => {
    const state = stateFor(requestId)
    const before = state.uploaded.length
    state.uploaded = state.uploaded.filter((file) => !fileIds.includes(file.fileId))
    // The entries were built from `uploaded`, so they are rebuilt without them.
    state.entries = null
    state.entriesFor = 0
    save()

    return later<T.DiscardResponse>({
      status: "ok",
      discarded: before - state.uploaded.length,
      remaining: state.uploaded.length,
    })
  },
}
