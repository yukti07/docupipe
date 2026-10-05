import { useEffect } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render } from "@/test/render"
import { api } from "@/lib/api"
import type { SchemaPollResponse } from "@/lib/api/types"
import { useBatch, type UseBatch } from "@/state/batch"
import { readRememberedFiles, readUnreadable } from "@/state/batchFiles"

/**
 * A discarded file is soft-deleted on the server, so no later poll mentions
 * it. If this browser keeps remembering it, the next load puts it back as a
 * row nothing can ever answer for.
 */

const REQ = "req_1"

const remembered = (fileId: string, fileName: string) => ({
  fileId,
  fileName,
  fileLocation: fileName,
  size: 10,
  filePath: `p/${fileId}`,
  expiresAt: "2099-01-01T00:00:00Z",
})

/** What the server says once the discard has gone through. */
const afterDiscard = (): SchemaPollResponse => ({
  userId: "usr_1",
  requestId: REQ,
  pending: 0,
  convertAvailable: true,
  convertBlockedReason: null,
  files: [],
})

let latest: UseBatch
const publish = (batch: UseBatch) => {
  latest = batch
}
function Probe() {
  const batch = useBatch(REQ, "usr_1")
  useEffect(() => publish(batch))
  return null
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

const seed = () => {
  localStorage.setItem(
    `quarry.batch.${REQ}.files`,
    JSON.stringify([remembered("f_good", "good.pdf"), remembered("f_bad", "scan.pdf")]),
  )
  localStorage.setItem(`quarry.batch.${REQ}.unreadable`, JSON.stringify(["f_bad"]))
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.spyOn(api, "pollSchemas").mockResolvedValue(afterDiscard())
})

describe("discarding a file", () => {
  it("takes it out of what this browser remembers", async () => {
    seed()
    vi.spyOn(api, "discardFiles").mockResolvedValue({
      status: "ok",
      discarded: 1,
      remaining: 1,
    })

    render(<Probe />)
    await flush()
    expect(latest.files.map((f) => f.fileId)).toEqual(["f_good", "f_bad"])

    await act(async () => {
      await latest.discardFiles(["f_bad"])
    })

    expect(latest.files.map((f) => f.fileId)).toEqual(["f_good"])
    expect(readRememberedFiles(REQ).map((f) => f.fileId)).toEqual(["f_good"])
    expect(readUnreadable(REQ)).toEqual([])
  })

  it("does not bring it back on a fresh mount", async () => {
    seed()
    vi.spyOn(api, "discardFiles").mockResolvedValue({
      status: "ok",
      discarded: 1,
      remaining: 1,
    })

    const first = render(<Probe />)
    await flush()
    await act(async () => {
      await latest.discardFiles(["f_bad"])
    })
    first.unmount()

    render(<Probe />)
    await flush()
    expect(latest.files.map((f) => f.fileId)).toEqual(["f_good"])
    expect(latest.acceptedCount).toBe(1)
  })

  it("keeps the file when the server refuses the discard", async () => {
    seed()
    vi.spyOn(api, "discardFiles").mockRejectedValue(new Error("nope"))

    render(<Probe />)
    await flush()
    await act(async () => {
      await latest.discardFiles(["f_bad"])
    })

    // A discard that failed and looked like it worked is the worse outcome.
    expect(latest.files.map((f) => f.fileId)).toEqual(["f_good", "f_bad"])
    expect(readRememberedFiles(REQ).map((f) => f.fileId)).toEqual(["f_good", "f_bad"])
  })
})
