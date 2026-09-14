import "server-only"

import { randomBytes, randomUUID } from "node:crypto"

import type { FailureClass } from "@/lib/api/types"
import { ApiFailure, Unauthenticated, envelope } from "./failures"
import { asObject } from "./validate"

/**
 * The shared shape of every route.
 *
 * It exists so that three things are structural rather than remembered: every
 * response carries a trace id, every failure leaves through one envelope, and
 * no raw exception message ever reaches a client.
 */

export function newId(prefix: string, bytes = 8): string {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`
}

export function newTraceId(): string {
  return `req_${randomUUID().replace(/-/g, "").slice(0, 16)}`
}

type Handler = (body: Record<string, unknown>, traceId: string) => Promise<unknown>

export function route(name: string, handler: Handler) {
  return async function POST(request: Request): Promise<Response> {
    // Honour an inbound id so one click can be followed across services, but
    // never trust its shape.
    const inbound = request.headers.get("x-request-id")
    const traceId = inbound && /^[A-Za-z0-9_-]{1,64}$/.test(inbound) ? inbound : newTraceId()

    const started = Date.now()
    let body: Record<string, unknown>

    try {
      body = asObject(await request.json())
    } catch {
      return json(
        envelope("internal", traceId, { message: "Expected a JSON body." }),
        400,
        traceId,
      )
    }

    try {
      const result = await handler(body, traceId)
      log("INFO", { route: name, traceId, ms: Date.now() - started })
      return json(result, 200, traceId)
    } catch (error) {
      return failure(name, error, traceId, started)
    }
  }
}

function failure(name: string, error: unknown, traceId: string, started: number): Response {
  if (error instanceof Unauthenticated) {
    log("INFO", { route: name, traceId, status: 401, ms: Date.now() - started })
    // No failure class: this is not a document problem, and the client's
    // `classOf` would render it as "unknown" anyway.
    return json({ error: "unauthenticated", requestTraceId: traceId }, 401, traceId)
  }

  if (error instanceof ApiFailure) {
    log("INFO", {
      route: name,
      traceId,
      status: error.status,
      failureClass: error.failureClass,
      ms: Date.now() - started,
    })
    return json(
      envelope(error.failureClass, traceId, {
        message: error.message,
        extra: error.extra,
      }),
      error.status,
      traceId,
    )
  }

  // Anything unrecognised becomes `internal`. The detail goes to the log and
  // never to the client — a stack trace is not a sentence anyone can act on.
  log("ERROR", {
    route: name,
    traceId,
    status: 500,
    ms: Date.now() - started,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  })
  return json(envelope("internal", traceId), 500, traceId)
}

function json(body: unknown, status: number, traceId: string): Response {
  return Response.json(body, {
    status,
    headers: {
      "x-request-id": traceId,
      // Nothing here is ever cacheable: every response is scoped to one
      // session and most of it changes every two seconds.
      "cache-control": "no-store",
    },
  })
}

export function log(severity: "INFO" | "WARNING" | "ERROR", fields: Record<string, unknown>) {
  console.log(JSON.stringify({ severity, ...fields }))
}

export function fail(failureClass: FailureClass, message?: string, extra?: Record<string, unknown>) {
  return new ApiFailure(failureClass, { message, extra })
}
