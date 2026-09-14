import "server-only"

import type { FailureClass } from "@/lib/api/types"
import { FAILURES } from "@/lib/failures"

/**
 * Turning a failure class into an HTTP response.
 *
 * The copy comes from `lib/failures.ts` — the same map the UI renders — so the
 * server and the screen cannot describe the same situation differently. This
 * module only decides the status code and assembles the envelope.
 *
 * `http.ts` reads exactly this shape off a non-2xx body.
 */

export class ApiFailure extends Error {
  readonly failureClass: FailureClass
  readonly status: number
  readonly extra: Record<string, unknown>

  constructor(
    failureClass: FailureClass,
    options: { status?: number; message?: string; extra?: Record<string, unknown> } = {},
  ) {
    super(options.message ?? FAILURES[failureClass]?.message ?? failureClass)
    this.name = "ApiFailure"
    this.failureClass = failureClass
    this.status = options.status ?? statusFor(failureClass)
    this.extra = options.extra ?? {}
  }
}

/** Not a failure class — the caller has no session at all. */
export class Unauthenticated extends Error {
  constructor() {
    super("No session")
    this.name = "Unauthenticated"
  }
}

function statusFor(failureClass: FailureClass): number {
  switch (failureClass) {
    case "gate_not_met":
    case "merge_incompatible":
      return 409
    case "too_large":
      return 413
    default:
      return 400
  }
}

export function envelope(
  failureClass: FailureClass,
  requestTraceId: string,
  overrides: { message?: string; extra?: Record<string, unknown> } = {},
): Record<string, unknown> {
  const copy = FAILURES[failureClass]
  return {
    failureClass,
    message: overrides.message ?? copy?.message ?? "Something went wrong.",
    nextStep: copy?.nextStep ?? "Try again.",
    requestTraceId,
    ...overrides.extra,
  }
}
