import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"
import { server } from "@/test/msw/server"
import { ApiError, postJson } from "./http"

describe("postJson", () => {
  it("posts JSON and returns the parsed body", async () => {
    server.use(
      http.post("/api/thing", async ({ request }) => {
        expect(await request.json()).toEqual({ a: 1 })
        return HttpResponse.json({ ok: true })
      }),
    )
    await expect(postJson("/api/thing", { a: 1 })).resolves.toEqual({ ok: true })
  })

  it("turns a classified error body into an ApiError carrying the class", async () => {
    server.use(
      http.post("/api/thing", () =>
        HttpResponse.json(
          {
            failureClass: "gate_not_met",
            message: "7 files are still reading their shape.",
            pending: 7,
          },
          { status: 409 },
        ),
      ),
    )
    await expect(postJson("/api/thing", {})).rejects.toMatchObject({
      failure: { class: "gate_not_met", message: "7 files are still reading their shape." },
      status: 409,
    })
  })

  it("classifies an unclassified 500 as unknown, never as a raw string", async () => {
    server.use(http.post("/api/thing", () => new HttpResponse("boom", { status: 500 })))
    await expect(postJson("/api/thing", {})).rejects.toMatchObject({
      failure: { class: "unknown" },
    })
  })

  it("classifies a transport failure as network", async () => {
    server.use(http.post("/api/thing", () => HttpResponse.error()))
    const err = await postJson("/api/thing", {}).catch((e: unknown) => e as ApiError)
    expect((err as ApiError).failure.class).toBe("network")
  })

  /* --------------------------------------------------- lost session cookie */

  it("re-registers and retries once when a call 401s", async () => {
    localStorage.setItem("quarry.userId", "usr_abc")
    let registers = 0
    let attempts = 0
    server.use(
      http.post("/api/register", () => {
        registers += 1
        return HttpResponse.json({ status: "ok" })
      }),
      http.post("/api/thing", () => {
        attempts += 1
        // The cookie is missing on the first call and minted by register.
        if (attempts === 1) {
          return HttpResponse.json({ error: "unauthenticated" }, { status: 401 })
        }
        return HttpResponse.json({ ok: true })
      }),
    )

    await expect(postJson("/api/thing", {})).resolves.toEqual({ ok: true })
    expect(registers).toBe(1)
    expect(attempts).toBe(2)
  })

  it("gives up after one retry rather than looping on a persistent 401", async () => {
    localStorage.setItem("quarry.userId", "usr_abc")
    let attempts = 0
    server.use(
      http.post("/api/register", () => HttpResponse.json({ status: "ok" })),
      http.post("/api/thing", () => {
        attempts += 1
        return HttpResponse.json({ error: "unauthenticated" }, { status: 401 })
      }),
    )

    await expect(postJson("/api/thing", {})).rejects.toMatchObject({
      status: 401,
      failure: { message: "This browser is no longer signed in to your workspace." },
    })
    expect(attempts).toBe(2)
  })

  it("never tries to recover a 401 from register itself", async () => {
    localStorage.setItem("quarry.userId", "usr_abc")
    let registers = 0
    server.use(
      http.post("/api/register", () => {
        registers += 1
        return HttpResponse.json({ error: "unauthenticated" }, { status: 401 })
      }),
    )

    await expect(postJson("/api/register", { userId: "usr_abc" })).rejects.toMatchObject({
      status: 401,
    })
    expect(registers).toBe(1)
  })

  it("does not attempt recovery when there is no id to register", async () => {
    localStorage.clear()
    let registers = 0
    server.use(
      http.post("/api/register", () => {
        registers += 1
        return HttpResponse.json({ status: "ok" })
      }),
      http.post("/api/thing", () =>
        HttpResponse.json({ error: "unauthenticated" }, { status: 401 }),
      ),
    )

    await expect(postJson("/api/thing", {})).rejects.toMatchObject({ status: 401 })
    expect(registers).toBe(0)
  })

})
