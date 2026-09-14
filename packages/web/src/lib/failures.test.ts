import { describe, expect, it } from "vitest"
import { FAILURES, failureCopy } from "@/lib/failures"
import type { FailureClass } from "@/lib/api/types"

const ALL: FailureClass[] = [
  "acquisition", "format_locked", "format_corrupt", "format_unsupported",
  "extract_empty", "schema_not_found", "schema_inference_failed",
  "merge_incompatible", "too_large", "provider_quota_exhausted",
  "provider_refused", "response_unparseable", "field_unresolved",
  "field_unsupported_by_evidence", "verification_failed", "budget_exceeded",
  "gate_not_met", "empty_file", "archive_not_expanded", "network", "unknown",
]

describe("the failure taxonomy", () => {
  it("has copy for every class — no class can reach a screen unnamed", () => {
    for (const c of ALL) expect(FAILURES[c], c).toBeDefined()
  })

  it("gives every class a sentence and a next step", () => {
    for (const c of ALL) {
      expect(FAILURES[c].message.length, c).toBeGreaterThan(10)
      expect(FAILURES[c].nextStep.length, c).toBeGreaterThan(2)
    }
  })

  it("prefers the server's sentence when it sent one", () => {
    expect(
      failureCopy({
        class: "format_locked",
        message: "Password-protected, so its pages can't be opened.",
      }).message,
    ).toBe("Password-protected, so its pages can't be opened.")
  })

  it("falls back to our copy when the server sent none", () => {
    expect(failureCopy({ class: "format_locked" }).message).toBe(FAILURES.format_locked.message)
  })

  it("treats a quota pause as a pause, not an error", () => {
    expect(FAILURES.provider_quota_exhausted.tone).toBe("paused")
    expect(FAILURES.budget_exceeded.tone).toBe("paused")
  })

  it("marks the two settled schema classes as non-blocking for Convert", () => {
    expect(FAILURES.schema_not_found.blocksConvert).toBe(false)
    expect(FAILURES.schema_inference_failed.blocksConvert).toBe(false)
  })
})
