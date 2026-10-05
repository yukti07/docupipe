import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen } from "@/test/render"
import { api } from "@/lib/api"
import type { SchemaPollResponse } from "@/lib/api/types"
import { BatchProvider, useBatchContext } from "@/state/batchContext"

const poll = (): SchemaPollResponse => ({
  userId: "usr_1",
  requestId: "req_1",
  pending: 0,
  convertAvailable: true,
  convertBlockedReason: null,
  files: [],
})

function Reader({ label }: { label: string }) {
  const batch = useBatchContext()
  return <p>{`${label}:${batch.files.length}`}</p>
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe("BatchProvider", () => {
  it("polls once however many readers are under it", async () => {
    localStorage.setItem(
      "quarry.batch.req_1.files",
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

    render(
      <BatchProvider requestId="req_1" userId="usr_1" pollSchemas>
        <Reader label="one" />
        <Reader label="two" />
      </BatchProvider>,
    )
    await flush()

    expect(pollSchemas).toHaveBeenCalledTimes(1)
    expect(screen.getByText("one:1")).toBeVisible()
    expect(screen.getByText("two:1")).toBeVisible()
  })

  it("does not poll on a screen that has no use for schemas", async () => {
    const pollSchemas = vi.spyOn(api, "pollSchemas").mockResolvedValue(poll())

    render(
      <BatchProvider requestId="req_1" userId="usr_1" pollSchemas={false}>
        <Reader label="one" />
      </BatchProvider>,
    )
    await flush()

    expect(pollSchemas).not.toHaveBeenCalled()
  })

  it("refuses to be read outside its provider, rather than handing back an empty batch", () => {
    // An empty batch would render as "nothing staged in this browser", which
    // is a sentence about the user's files, not about a missing provider.
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => render(<Reader label="loose" />)).toThrow(
      /useBatchContext must be used inside a BatchProvider/,
    )
  })
})
