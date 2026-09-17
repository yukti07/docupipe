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

/** What every `catch (error)` around a call into this module reduces to. */
export function toFailure(error: unknown): Failure {
  return error instanceof ApiError ? error.failure : { class: "unknown" }
}

/**
 * Recovering from a lost session cookie.
 *
 * The `sid` cookie is httpOnly, so nothing on the client can see whether it is
 * still there. `quarry.registered` in localStorage is only a guess about it,
 * and the two drift apart the moment cookies are cleared without local storage
 * going with them. Once they disagree nothing re-registers, every later call is
 * a 401, and the only way out is clearing site data by hand.
 *
 * So a 401 is read as "the cookie went missing", not as a dead end: the id is
 * registered again, which mints a fresh cookie, and the call is retried once.
 * The import is dynamic because `session` reaches back into this module.
 */
let reauth: Promise<boolean> | null = null

async function reauthenticate(): Promise<boolean> {
  // Single-flight: a poll loop that 401s on every tick must not open one
  // register call per tick.
  reauth ??= (async () => {
    try {
      const { getUserId } = await import("@/lib/session")
      const userId = getUserId()
      if (!userId) return false
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      })
      return res.ok
    } catch {
      return false
    } finally {
      // Cleared on the next tick so callers awaiting this round all see it.
      setTimeout(() => {
        reauth = null
      }, 0)
    }
  })()
  return reauth
}

export async function postJson<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  /** Internal: set once a 401 has already been recovered from. */
  retried = false,
): Promise<T> {
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

  // `/api/register` is the thing that fixes a 401 — it must never recurse
  // into itself, and it does not require a session in the first place.
  if (res.status === 401 && !retried && path !== "/api/register") {
    if (await reauthenticate()) return postJson<T>(path, body, signal, true)
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

  // A 401 carries no failure class — it is not a document problem — so without
  // this it renders as "unknown", which says nothing anyone can act on. By here
  // re-registering has already been tried and did not take.
  if (res.status === 401) {
    throw new ApiError(
      {
        class: "unknown",
        message: "This browser is no longer signed in to your workspace.",
        nextStep: "Reload the page. If that doesn't help, open your workspace link again.",
      },
      401,
      parsed,
    )
  }

  throw new ApiError(
    { class: classOf(shape.failureClass), message: shape.message, nextStep: shape.nextStep },
    res.status,
    parsed,
  )
}
