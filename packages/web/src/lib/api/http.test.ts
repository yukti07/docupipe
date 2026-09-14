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
})
