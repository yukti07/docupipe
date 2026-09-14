import { http, HttpResponse } from "msw"
import { describe, expect, it, vi } from "vitest"
import { server } from "@/test/msw/server"
import { ensureSession, getUserId, newRequestId, workspaceLink } from "./session"

describe("session", () => {
  it("generates a user id with real entropy and keeps it", async () => {
    server.use(http.post("/api/register", () => HttpResponse.json({ status: "ok" })))
    const id = await ensureSession()
    expect(id).toMatch(/^usr_[A-Za-z0-9_-]{22,}$/)
    expect(getUserId()).toBe(id)
  })

  it("registers once, not on every call", async () => {
    const seen = vi.fn()
    server.use(
      http.post("/api/register", () => {
        seen()
        return HttpResponse.json({ status: "ok" })
      }),
    )
    const first = await ensureSession()
    const second = await ensureSession()
    expect(second).toBe(first)
    expect(seen).toHaveBeenCalledOnce()
  })

  it("adopts an id handed over in the url, because that is the share mechanism", async () => {
    server.use(http.post("/api/register", () => HttpResponse.json({ status: "ok" })))
    const id = await ensureSession("usr_sharedsharedsharedshared")
    expect(id).toBe("usr_sharedsharedsharedshared")
  })

  it("builds a link that carries the workspace", () => {
    expect(workspaceLink("usr_abc", "https://q.app")).toBe("https://q.app/?w=usr_abc")
  })

  it("mints a fresh request id per drop, so getSignedUrl stays idempotent", () => {
    expect(newRequestId()).not.toBe(newRequestId())
    expect(newRequestId()).toMatch(/^req_[A-Za-z0-9_-]{12}$/)
  })
})
