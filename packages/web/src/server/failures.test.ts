import { describe, expect, it } from "vitest"

import { ApiError } from "@/lib/api/http"
import type { FailureClass } from "@/lib/api/types"
import { ApiFailure, envelope } from "./failures"

/**
 * The envelope this side writes must be the envelope the client reads.
 *
 * These two modules were written independently and are the seam where a
 * mismatch would show up as every error rendering as "unknown" — silently, and
 * only in production.
 */

async function throughHttp(body: unknown, status: number): Promise<ApiError> {
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch

  try {
    const { postJson } = await import("@/lib/api/http")
    await postJson("/api/whatever", {})
    throw new Error("expected postJson to throw")
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  } finally {
    globalThis.fetch = original
  }
}

describe("the error envelope", () => {
  it("survives the round trip with its class intact", async () => {
    const body = envelope("format_locked", "req_abc")
    const error = await throughHttp(body, 400)

    expect(error.failure.class).toBe("format_locked")
    expect(error.failure.message).toBe("This PDF is password protected.")
    expect(error.failure.nextStep).toBe("Remove the password and upload it again.")
  })

  it("carries a server-written message over the default copy", async () => {
    const body = envelope("gate_not_met", "req_abc", {
      message: "7 files are still reading their shape.",
      extra: { pending: 7 },
    })
    const error = await throughHttp(body, 409)

    expect(error.failure.class).toBe("gate_not_met")
    expect(error.failure.message).toBe("7 files are still reading their shape.")
    expect((error.body as { pending: number }).pending).toBe(7)
  })

  it("always carries the trace id", () => {
    expect(envelope("internal", "req_xyz").requestTraceId).toBe("req_xyz")
  })

  it.each([
    ["gate_not_met", 409],
    ["merge_incompatible", 409],
    ["too_large", 413],
    ["acquisition", 400],
    ["internal", 400],
  ] as [FailureClass, number][])("maps %s to %i", (failureClass, status) => {
    expect(new ApiFailure(failureClass).status).toBe(status)
  })

  it("takes its copy from the same map the UI renders", () => {
    // Not a second set of sentences that can drift from the screen's.
    const body = envelope("empty_file", "req_abc")
    expect(body.message).toBe("This file is empty.")
  })
})
