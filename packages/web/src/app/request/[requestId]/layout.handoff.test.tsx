import { delay, http, HttpResponse } from "msw"
import { Suspense, type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen, waitFor } from "@/test/render"
import { server } from "@/test/msw/server"
import { stageFiles } from "@/lib/preflight"
import { stageForRequest } from "@/state/staged"
import { WorkspaceProvider } from "@/state/workspace"
import RequestLayout from "./layout"
import BatchPage from "./page"
import ReviewSchemasPage from "./schemas/page"

const router = { push: vi.fn(), replace: vi.fn() }
let pathname = "/request/req_1"
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}))

const REQUEST = "req_1"
const PUT_URL = "https://storage.googleapis.com/quarry"
const NAMES = ["invoice-1.pdf", "invoice-2.pdf", "invoice-3.pdf"]

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

/**
 * Three files up, with the last one's bytes never landing. Two reach the
 * bucket and are remembered; the third exists only in the reducer, which is
 * what makes it the file a second `useBatch` could not have known about.
 */
function mockBackend() {
  const confirmed: string[] = []
  server.use(
    http.post("/api/register", () => HttpResponse.json({ status: "ok" })),
    http.post("/api/getSignedUrl", async ({ request }) => {
      const body = (await request.json()) as { files: string[] }
      return HttpResponse.json({
        userId: "usr_1",
        requestId: REQUEST,
        files: body.files.map((fileName, index) => ({
          fileId: `file_${index + 1}`,
          fileName,
          filePath: `${PUT_URL}/${index}?X-Goog-Signature=abc`,
          uploadHeaders: { "Content-Type": "application/pdf" },
          expiresAt: "2099-01-01T00:00:00Z",
        })),
      })
    }),
    http.put(`${PUT_URL}/:n`, async ({ params }) => {
      // Two at a time, so holding the last one open leaves it genuinely in
      // flight rather than merely queued behind the others.
      if (params.n === "2") await delay("infinite")
      return new HttpResponse(null, { status: 200 })
    }),
    http.post("/api/upload", async ({ request }) => {
      const body = (await request.json()) as { files: { fileId: string }[] }
      confirmed.push(...body.files.map((f) => f.fileId))
      return HttpResponse.json({
        status: "ok",
        files: body.files.map((f) => ({ fileId: f.fileId, stage: "UPLOADED" })),
      })
    }),
    // No shape has come back for anything, so every file is still outstanding
    // and the review screen has to name all of them.
    http.post("/api/polling/schema", () =>
      HttpResponse.json({
        userId: "usr_1",
        requestId: REQUEST,
        pending: 3,
        convertAvailable: false,
        convertBlockedReason: null,
        files: [],
      }),
    ),
  )
  return confirmed
}

// One promise for the life of the test: `use()` reads a resolved promise from
// cache, so a fresh one on rerender would suspend the layout a second time and
// muddy exactly what this test is about.
const layoutParams = Promise.resolve({ requestId: REQUEST })
const pageParams = Promise.resolve({ requestId: REQUEST })
const pageSearch = Promise.resolve({})

const tree = (children: ReactNode) => (
  <WorkspaceProvider>
    <Suspense fallback={<p>loading layout</p>}>
      <RequestLayout params={layoutParams}>
        <Suspense fallback={<p>loading page</p>}>{children}</Suspense>
      </RequestLayout>
    </Suspense>
  </WorkspaceProvider>
)

describe("moving between the screens of one request", () => {
  it("carries every dropped file onto Review schemas, including one still uploading", async () => {
    const confirmed = mockBackend()
    stageForRequest(REQUEST, stageFiles(NAMES.map((name) => new File(["x".repeat(32)], name))))

    let rerender!: ReturnType<typeof render>["rerender"]
    await act(async () => {
      ;({ rerender } = render(tree(<BatchPage params={pageParams} searchParams={pageSearch} />)))
    })

    // Mid-upload on purpose: two files have reached the bucket and been
    // remembered, the third has not. Only the reducer knows about all three,
    // so a second `useBatch` here would have to fall back and undercount.
    await waitFor(() => expect(confirmed).toEqual(["file_1", "file_2"]))

    // The same layout element in the same position, with the child swapped —
    // which is what a route change under one layout does. Remounting it would
    // hand the test the reload that already masked this bug.
    pathname = `/request/${REQUEST}/schemas`
    await act(async () => {
      rerender(tree(<ReviewSchemasPage params={pageParams} searchParams={pageSearch} />))
    })

    expect(await screen.findByText("Detecting schemas")).toBeVisible()
    for (const name of NAMES) {
      expect(await screen.findByText(name)).toBeVisible()
    }
    // The third file never landed, so nothing has confirmed it since.
    expect(confirmed).toEqual(["file_1", "file_2"])
  })
})
