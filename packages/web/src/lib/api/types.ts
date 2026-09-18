// The seven endpoints, verbatim from backend-infrastructure-execution-plan.md §0.
// Anything not in that section belongs under "Fixture surfaces" at the bottom.

export type FieldType = "text" | "number" | "date" | "currency" | "boolean" | "list"

export const FIELD_TYPES: readonly FieldType[] = [
  "text",
  "number",
  "date",
  "currency",
  "boolean",
  "list",
] as const

export type FailureClass =
  | "acquisition"
  | "format_locked"
  | "format_corrupt"
  | "format_unsupported"
  | "extract_empty"
  | "schema_not_found"
  | "schema_inference_failed"
  | "merge_incompatible"
  | "too_large"
  | "provider_quota_exhausted"
  | "provider_refused"
  | "response_unparseable"
  | "field_unresolved"
  | "field_unsupported_by_evidence"
  | "verification_failed"
  | "budget_exceeded"
  | "gate_not_met"
  | "empty_file"
  | "archive_not_expanded"
  /* operational — the worker's own failures, not the document's */
  | "processing_failed"
  | "max_attempts"
  | "internal"
  /* client-only; never sent by the server */
  | "network"
  | "not_implemented"
  | "unknown"

export type Failure = {
  class: FailureClass
  /** The server's sentence. Never rendered raw — FailureMessage owns the copy. */
  message?: string
  nextStep?: string
}

export type SchemaField = {
  key: string
  label: string
  type: FieldType
  origin: "detected" | "added"
}

export type TableSchema = {
  tableOrd: number
  tableLabel: string
  version: number
  /** Hash of the ORIGINAL inferred fields — what apply-to-all matches on. */
  shapeHash: string
  matchingFileCount: number
  fields: SchemaField[]
}

/* §0.1 */
export type RegisterResponse = { status: "ok" }

/* §0.2 */
export type SignedUrlFile = {
  fileId: string
  fileName: string
  /** The signed PUT URL itself, not an object key. */
  filePath: string
  uploadHeaders: Record<string, string>
  expiresAt: string
}
export type SignedUrlResponse = {
  userId: string
  requestId: string
  files: SignedUrlFile[]
}

/* §0.3 */
export type UploadedFile = {
  fileId: string
  fileName: string
  filePath: string
  /** webkitRelativePath for a folder drop, the plain name otherwise. Display only. */
  fileLocation: string
}
export type UploadResponse = {
  status: "ok"
  files: {
    fileId: string
    stage: "UPLOADED" | "FAILED"
    failureClass?: FailureClass
    message?: string
    nextStep?: string
  }[]
}

/* §0.4 — one entry per (fileId, schemaId); a 3-table file is three entries */
export type SchemaEntry = {
  fileId: string
  fileName: string
  filePath: string
  schemaId: string | null
  status: "ready" | "failed"
  schema: TableSchema | null
  failure?: Failure
}
export type SchemaPollResponse = {
  userId: string
  requestId: string
  pending: number
  convertAvailable: boolean
  convertBlockedReason: string | null
  files: SchemaEntry[]
}

/* §0.5 */
export type SchemaSaveEntry = {
  fileId: string
  fileName: string
  filePath: string
  schemaId: string
  schema: { fields: SchemaField[] }
}
export type UpdateSchemaResponse = {
  status: "ok"
  updated: { schemaId: string; version: number }[]
}

/* §0.6 */
export type ConvertResponse = { status: "received"; queued: number; skipped: number }

/** Files taken out of a request for good. `remaining` is what is still live in it. */
export type DiscardResponse = { status: "ok"; discarded: number; remaining: number }

/* §0.7 */
export type ConvertStage = "QUEUED" | "EXTRACTING" | "FILLING" | "DONE" | "FAILED"
export type ResultEntry = {
  fileId: string
  fileName: string
  schemaId: string
  stage: ConvertStage
  rowCount?: number
  fieldCount?: number
  toCheckCount?: number
  progress?: { unit: "page" | "row"; at: number; of: number }
  failure?: Failure
}
export type ResultPollResponse = {
  userId: string
  requestId: string
  status: "CONVERTING" | "PAUSED" | "COMPLETED" | "FAILED"
  pausedUntil: string | null
  counts: { queued: number; extracting: number; filling: number; done: number; failed: number }
  rowsSoFar: number
  estimatedSecondsRemaining: number | null
  allowance: { used: number; limit: number; resetsAt: string }
  files: ResultEntry[]
}

/* ------------------------------------------------------------------ */
/* Fixture surfaces — §0.9. Same types when they go live.              */
/* ------------------------------------------------------------------ */

export type CellState = "value" | "not-found" | "marked"

export type CellValue = {
  valueId: string
  display: string
  state: CellState
  /** Present only when state is "marked". The server decides; the UI never re-derives it. */
  reason?: string
}

export type TableRow = {
  recordId: string
  /** A row the document could not yield at all. Greyed, labelled, reason one click away. */
  failed?: Failure
  /** Which table this row came from. Set only on a merged table. */
  sourceFile?: string
  values: Record<string, CellValue>
}

export type TableData = {
  requestId: string
  schemaId: string
  fileId: string
  fileName: string
  tableLabel: string
  pageRange: string | null
  /** Several tables unioned. Every row then carries `sourceFile`. */
  merged?: boolean
  fields: SchemaField[]
  rows: TableRow[]
}

/** Fractions of page size, never raw points — two PDF engines must agree (D17). */
export type BoxFraction = { x: number; y: number; w: number; h: number }

export type Locator =
  | { type: "page"; documentUrl: string; page: number; pageCount: number; box: BoxFraction }
  | {
      type: "audio"
      audioUrl: string
      startMs: number
      endMs: number
      transcript: string
      speaker: string | null
      speakerInferred: true
    }
  | { type: "text"; paragraph: string; start: number; end: number }
  | { type: "record"; path: string; sheet?: string; row?: number; column?: string }
  | { type: "none"; sourceText: string; reason: string }

export type Evidence = {
  valueId: string
  fieldKey: string
  rowIndex: number
  display: string
  reason?: string
  locator: Locator
}

export type RawText = {
  schemaId: string
  fileName: string
  pages: { page: number; text: string }[]
}

export type MergeGroup = {
  shapeHash: string
  name: string
  fields: SchemaField[]
  members: {
    schemaId: string
    fileId: string
    fileName: string
    tableLabel: string
    rowCount: number
    toCheckCount: number
    convertedAt: string
  }[]
}

export type MergeConflictDetail = {
  field: string
  /** Which submitted group the conflict is in — one submit carries several. */
  shapeHash?: string
  groups: { type: FieldType; tableNames: string[] }[]
}

/** A merge that exists: its members are gone from the results list, replaced by this. */
export type MergedTable = {
  mergeId: string
  name: string
  rowCount: number
  /** How many tables went into it. */
  tableCount: number
  shapeHash: string
}

export type MergeOverview = {
  /** Finished tables not already in a merge, grouped by the shape they have now. */
  groups: MergeGroup[]
  merges: MergedTable[]
  /** Tables in this batch right now, counting each existing merge as one. */
  tableCount: number
}

/** One group in a submit: several of these go up together. */
export type MergeSubmission = { name: string; schemaIds: string[] }

export type MergeResult =
  | { ok: true; merges: MergedTable[]; tableCount: number }
  | { ok: false; failure: Failure; conflicts: MergeConflictDetail[] }
