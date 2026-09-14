import { http, HttpResponse } from "msw"
import { describe, expect, it, vi } from "vitest"
import { server } from "@/test/msw/server"
import { UPLOAD_CONCURRENCY, putFile, uploadAll, type UploadTask } from "./upload"

const URL_BASE = "https://storage.googleapis.com/quarry"

const task = (n: number, headers: Record<string, string> = {}): UploadTask => ({
  localId: `stg_${n}`,
  file: new File(["x".repeat(64)], `invoice-${1043 + n}.pdf`),
  url: `${URL_BASE}/${n}?X-Goog-Signature=abc`,
  headers,
})

const ok = () => server.use(http.put(`${URL_BASE}/:n`, () => new HttpResponse(null, { status: 200 })))

describe("putFile", () => {
  it("sends the upload headers verbatim and adds nothing of its own", async () => {
    let seen: Headers | null = null
    server.use(
      http.put(`${URL_BASE}/:n`, ({ request }) => {
        seen = request.headers
        return new HttpResponse(null, { status: 200 })
      }),
    )
    await putFile(task(1, { "Content-Type": "application/pdf" }))
    expect(seen!.get("content-type")).toBe("application/pdf")
    expect(seen!.get("authorization")).toBeNull()
    expect(seen!.get("x-goog-meta-source")).toBeNull()
  })

  it("settles a rejected PUT as an acquisition failure rather than throwing", async () => {
    server.use(http.put(`${URL_BASE}/:n`, () => new HttpResponse(null, { status: 403 })))
    const failure = await putFile(task(1))
    expect(failure?.class).toBe("acquisition")
    expect(failure?.nextStep).toMatch(/Retry this file/)
  })

  it("reports the file as fully sent once it lands", async () => {
    ok()
    const onProgress = vi.fn()
    await putFile(task(1), { onProgress })
    const last = onProgress.mock.calls.at(-1)
    expect(last?.[0]).toBe("stg_1")
    expect(last?.[1]).toBe(last?.[2])
  })
})

describe("uploadAll", () => {
  it("runs two at a time, matching the canvas", async () => {
    let live = 0
    let peak = 0
    server.use(
      http.put(`${URL_BASE}/:n`, async () => {
        live += 1
        peak = Math.max(peak, live)
        await new Promise((r) => setTimeout(r, 20))
        live -= 1
        return new HttpResponse(null, { status: 200 })
      }),
    )
    await uploadAll(Array.from({ length: 6 }, (_, i) => task(i)))
    expect(peak).toBe(UPLOAD_CONCURRENCY)
  })

  it("lets one file fail without touching the other five", async () => {
    server.use(
      http.put(`${URL_BASE}/:n`, ({ params }) =>
        params.n === "3"
          ? new HttpResponse(null, { status: 500 })
          : new HttpResponse(null, { status: 200 }),
      ),
    )
    const outcomes = await uploadAll(Array.from({ length: 6 }, (_, i) => task(i)))
    expect(outcomes.get("stg_3")?.class).toBe("acquisition")
    for (const id of ["stg_0", "stg_1", "stg_2", "stg_4", "stg_5"]) {
      expect(outcomes.get(id), id).toBeUndefined()
    }
  })

  it("retries one file on its own, leaving the rest alone", async () => {
    let attempts = 0
    server.use(
      http.put(`${URL_BASE}/:n`, () => {
        attempts += 1
        return new HttpResponse(null, { status: attempts === 1 ? 500 : 200 })
      }),
    )
    const only = task(3)
    expect((await uploadAll([only])).get("stg_3")?.class).toBe("acquisition")
    expect((await uploadAll([only])).get("stg_3")).toBeUndefined()
    expect(attempts).toBe(2)
  })

  it("tells the caller about every file it settled, in order of completion", async () => {
    ok()
    const settled: string[] = []
    await uploadAll(Array.from({ length: 3 }, (_, i) => task(i)), {
      onSettled: (localId) => settled.push(localId),
    })
    expect(settled.sort()).toEqual(["stg_0", "stg_1", "stg_2"])
  })
})
