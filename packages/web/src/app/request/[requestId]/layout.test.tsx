import { http, HttpResponse } from "msw"
import { Suspense } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen, waitFor } from "@/test/render"
import { server } from "@/test/msw/server"
import { api } from "@/lib/api"
import type { SchemaPollResponse } from "@/lib/api/types"
import { useBatchContext } from "@/state/batchContext"
import RequestLayout from "./layout"

let pathname = "/request/req_1"
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}))

const REQUEST = "req_1"

const poll = (): SchemaPollResponse => ({
  userId: "usr_1",
  requestId: REQUEST,
  pending: 0,
  convertAvailable: true,
  convertBlockedReason: null,
  files: [],
})

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

/** Renders only once the batch has hydrated, which is the gate's precondition. */
function Child() {
  const batch = useBatchContext()
  return <p>{`files:${batch.files.length}`}</p>
}

async function renderAt(path: string) {
  pathname = path
  server.use(http.post("/api/register", () => HttpResponse.json({ status: "ok" })))
  // A file the server already knows about, so `enabled` is not held shut by
  // there being nothing on the other end to ask about.
  localStorage.setItem(
    `quarry.batch.${REQUEST}.files`,
    JSON.stringify([
      {
        fileId: "f_1",
        fileName: "a.pdf",
        fileLocation: "a.pdf",
        size: 1,
        filePath: "p",
        expiresAt: "2099-01-01T00:00:00Z",
      },
    ]),
  )
  const pollSchemas = vi.spyOn(api, "pollSchemas").mockResolvedValue(poll())

  // The layout reads its route params with use(), and React only retries a
  // component that suspended during a synchronous act once that act is awaited.
  await act(async () => {
    render(
      <Suspense fallback={<p>loading</p>}>
        <RequestLayout params={Promise.resolve({ requestId: REQUEST })}>
          <Child />
        </RequestLayout>
      </Suspense>,
    )
  })
  // Hydrated: the session resolved, the remembered file is in state, and the
  // poll has had its chance to fire. Anything asserted after this is settled.
  expect(await screen.findByText("files:1")).toBeVisible()
  return pollSchemas
}

describe("the request layout's schema gate", () => {
  it("polls on the batch root, where the shapes are being waited on", async () => {
    const pollSchemas = await renderAt(`/request/${REQUEST}`)
    await waitFor(() => expect(pollSchemas).toHaveBeenCalled())
  })

  it("polls on Review schemas, which is the screen the shapes are for", async () => {
    const pollSchemas = await renderAt(`/request/${REQUEST}/schemas`)
    await waitFor(() => expect(pollSchemas).toHaveBeenCalled())
  })

  it("does not poll on a table, which is past the gate", async () => {
    const pollSchemas = await renderAt(`/request/${REQUEST}/table/sch_1`)
    expect(pollSchemas).not.toHaveBeenCalled()
  })

  it("does not poll on Merge, which is past the gate", async () => {
    const pollSchemas = await renderAt(`/request/${REQUEST}/merge`)
    expect(pollSchemas).not.toHaveBeenCalled()
  })
})
