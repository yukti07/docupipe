import type { Failure, FailureClass } from "@/lib/api/types"

export class ApiError extends Error {
  readonly failure: Failure
  readonly status: number
  readonly body: unknown

  constructor(failure: Failure, status: number, body: unknown) {
    super(failure.message ?? failure.class)
    this.name = "ApiError"
    this.failure = failure
    this.status = status
    this.body = body
  }
}

/**
 * Must stay identical to the `failure_class` Postgres enum and to the worker's
 * `failures.py`. It is one of the few pieces of product semantics that lives in
 * both languages, so it drifts silently: a class the server sends but this set
 * omits renders as "unknown", which is a worse sentence than the one we had.
 */
const KNOWN = new Set<string>([
  "acquisition", "format_locked", "format_corrupt", "format_unsupported", "extract_empty",
  "schema_not_found", "schema_inference_failed", "merge_incompatible", "too_large",
  "provider_quota_exhausted", "provider_refused", "response_unparseable", "field_unresolved",
  "field_unsupported_by_evidence", "verification_failed", "budget_exceeded", "gate_not_met",
  "empty_file", "archive_not_expanded",
  "processing_failed", "max_attempts", "internal",
  "network", "unknown",
])

function classOf(value: unknown): FailureClass {
  return typeof value === "string" && KNOWN.has(value) ? (value as FailureClass) : "unknown"
}

export async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    })
  } catch (cause) {
    if (signal?.aborted) throw cause
    throw new ApiError({ class: "network" }, 0, cause)
  }

  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }

  if (res.ok) return parsed as T

  const shape = (parsed ?? {}) as { failureClass?: string; message?: string; nextStep?: string }
  throw new ApiError(
    { class: classOf(shape.failureClass), message: shape.message, nextStep: shape.nextStep },
    res.status,
    parsed,
  )
}
