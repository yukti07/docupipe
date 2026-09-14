import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"
import { server } from "@/test/msw/server"
import { LiveApi } from "./live"

describe("LiveApi", () => {
  it("registers a user id", async () => {
    server.use(
      http.post("/api/register", async ({ request }) => {
        expect(await request.json()).toEqual({ userId: "usr_abc" })
        return HttpResponse.json({ status: "ok" })
      }),
    )
    await expect(LiveApi.register("usr_abc")).resolves.toEqual({ status: "ok" })
  })

  it("asks for signed URLs with bare filenames, as the contract specifies", async () => {
    server.use(
      http.post("/api/getSignedUrl", async ({ request }) => {
        expect(await request.json()).toEqual({
          userId: "usr_abc",
          requestId: "req_1",
          files: ["a.pdf", "b.pdf"],
        })
        return HttpResponse.json({ userId: "usr_abc", requestId: "req_1", files: [] })
      }),
    )
    await LiveApi.getSignedUrls("usr_abc", "req_1", ["a.pdf", "b.pdf"])
  })

  it("sends the received list on a schema poll so the server can send a delta", async () => {
    server.use(
      http.post("/api/polling/schema", async ({ request }) => {
        expect(await request.json()).toMatchObject({ received: ["f1"] })
        return HttpResponse.json({
          userId: "u", requestId: "r", pending: 0,
          convertAvailable: true, convertBlockedReason: null, files: [],
        })
      }),
    )
    const res = await LiveApi.pollSchemas("u", "r", ["f1"])
    expect(res.convertAvailable).toBe(true)
  })
})
