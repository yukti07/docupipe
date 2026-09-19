import { beforeEach, describe, expect, it } from "vitest"
import { FixtureSeven } from "./fixtureSeven"

const USER = "usr_test"
let request = 0
/** A fresh id per test: the fixture keeps state per request, deliberately. */
const nextRequest = () => `req_fx_${(request += 1)}`

async function sign(requestId: string, count: number) {
  const names = Array.from({ length: count }, (_, i) => `doc-${i}.pdf`)
  return FixtureSeven.getSignedUrls(USER, requestId, names)
}

/** Polls until nothing is pending, returning every entry that came back. */
async function drainSchemas(requestId: string) {
  const received: string[] = []
  const entries = []
  for (let i = 0; i < 12; i += 1) {
    const response = await FixtureSeven.pollSchemas(USER, requestId, received)
    entries.push(...response.files)
    for (const entry of response.files) {
      if (!received.includes(entry.fileId)) received.push(entry.fileId)
    }
    if (response.pending === 0) return { entries, response }
  }
  throw new Error("the schema poll never settled")
}

beforeEach(() => {
  sessionStorage.clear()
})

describe("the seven, on fixtures", () => {
  it("signs a fixture url rather than a bucket, so nothing is PUT anywhere", async () => {
    const { files } = await sign(nextRequest(), 3)
    expect(files).toHaveLength(3)
    for (const file of files) expect(file.filePath).toMatch(/^fixture:\/\/upload\//)
  })

  it("re-signs the same file to the same id, so a retry does not double the row", async () => {
    const requestId = nextRequest()
    const first = await sign(requestId, 2)
    const again = await FixtureSeven.getSignedUrls(USER, requestId, ["doc-0.pdf"])
    expect(again.files[0].fileId).toBe(first.files[0].fileId)
  })

  it("delivers a shape for every file that was signed, and no others", async () => {
    const requestId = nextRequest()
    await sign(requestId, 6)
    const { entries } = await drainSchemas(requestId)
    expect(new Set(entries.map((e) => e.fileId)).size).toBe(6)
  })

  it("sends each file only once, since the client keeps only the delta", async () => {
    const requestId = nextRequest()
    await sign(requestId, 9)
    const { entries } = await drainSchemas(requestId)
    const ids = entries.map((e) => `${e.fileId}:${e.schemaId}`)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("holds the gate shut while anything is still pending", async () => {
    const requestId = nextRequest()
    await sign(requestId, 9)
    const first = await FixtureSeven.pollSchemas(USER, requestId, [])
    expect(first.pending).toBeGreaterThan(0)
    expect(first.convertAvailable).toBe(false)
    expect(first.convertBlockedReason).toBeTruthy()

    const { response } = await drainSchemas(requestId)
    expect(response.convertAvailable).toBe(true)
    expect(response.convertBlockedReason).toBeNull()
  })

  it("keeps a file's tables together, or the second one is lost to the delta", async () => {
    const requestId = nextRequest()
    await sign(requestId, 10)
    const received: string[] = []
    for (let i = 0; i < 12; i += 1) {
      const response = await FixtureSeven.pollSchemas(USER, requestId, received)
      // Every entry for a file arrives in the poll that first mentions it.
      for (const fileId of new Set(response.files.map((f) => f.fileId))) {
        expect(received).not.toContain(fileId)
        received.push(fileId)
      }
      if (response.pending === 0) break
    }
    expect(received).toHaveLength(10)
  })

  it("gives at least one file several tables and one no shape at all", async () => {
    const requestId = nextRequest()
    await sign(requestId, 10)
    const { entries } = await drainSchemas(requestId)

    const perFile = new Map<string, number>()
    for (const entry of entries) perFile.set(entry.fileId, (perFile.get(entry.fileId) ?? 0) + 1)

    expect([...perFile.values()].filter((n) => n > 1)).toHaveLength(1)

    // Two kinds of failure, and the screen treats them differently: a file that
    // gave up nothing names no table, and a worksheet that gave up nothing
    // names the table it is.
    const failed = entries.filter((e) => e.status === "failed")
    expect(failed.filter((e) => e.schemaId === null)).toHaveLength(1)
    expect(failed.filter((e) => e.schemaId !== null)).toHaveLength(1)
  })

  it("counts matching files across the batch, which is what apply-to-all reads", async () => {
    const requestId = nextRequest()
    await sign(requestId, 10)
    const { entries } = await drainSchemas(requestId)
    const totals = entries.filter((e) => e.schema?.shapeHash === "9c1f2a7e")
    expect(totals[0].schema?.matchingFileCount).toBe(totals.length)
  })

  it("reports nothing queued until Convert is pressed, so the probe reads true", async () => {
    const requestId = nextRequest()
    await sign(requestId, 4)
    await drainSchemas(requestId)

    const before = await FixtureSeven.pollResult(USER, requestId)
    expect(before.files).toHaveLength(0)
    expect(before.counts.done).toBe(0)

    await FixtureSeven.convert(USER, requestId)
    const after = await FixtureSeven.pollResult(USER, requestId)
    expect(after.files.length).toBeGreaterThan(0)
  })

  it("finishes every table it queued, and only counts rows for the finished ones", async () => {
    const requestId = nextRequest()
    await sign(requestId, 8)
    const { entries } = await drainSchemas(requestId)
    const ready = entries.filter((e) => e.status === "ready").length

    const queued = await FixtureSeven.convert(USER, requestId)
    expect(queued.queued).toBe(ready)
    expect(queued.skipped).toBe(entries.length - ready)

    let last = await FixtureSeven.pollResult(USER, requestId)
    for (let i = 0; i < 12 && last.status !== "COMPLETED"; i += 1) {
      const rows = last.rowsSoFar
      last = await FixtureSeven.pollResult(USER, requestId)
      // It only ever moves forward — a bar that goes backwards reads as a bug.
      expect(last.rowsSoFar).toBeGreaterThanOrEqual(rows)
    }

    expect(last.status).toBe("COMPLETED")
    expect(last.files).toHaveLength(ready)
    expect(last.counts.done + last.counts.failed).toBe(ready)
    expect(last.counts.queued + last.counts.extracting + last.counts.filling).toBe(0)
    expect(last.estimatedSecondsRemaining).toBeNull()
  })

  it("bumps a version on save and hands the edited fields back", async () => {
    const requestId = nextRequest()
    await sign(requestId, 3)
    const { entries } = await drainSchemas(requestId)
    const target = entries.find((e) => e.schemaId && e.schema)!

    const fields = target.schema!.fields.map((f, i) =>
      i === 0 ? { ...f, type: "number" as const } : f,
    )
    const saved = await FixtureSeven.updateSchemas(USER, requestId, [
      {
        fileId: target.fileId,
        fileName: target.fileName,
        filePath: target.filePath,
        schemaId: target.schemaId!,
        schema: { fields },
      },
    ])

    expect(saved.updated[0]).toEqual({ schemaId: target.schemaId, version: 2 })
    const again = await FixtureSeven.pollSchemas(USER, requestId, [])
    const reread = again.files.find((e) => e.schemaId === target.schemaId)
    expect(reread?.schema?.fields[0].type).toBe("number")
    expect(reread?.schema?.version).toBe(2)
  })

  it("stands in with the canned payload when nothing was dropped in this browser", async () => {
    const { entries, response } = await drainSchemas(nextRequest())
    expect(entries.length).toBeGreaterThan(40)
    expect(entries.some((e) => e.fileName === "invoice-1043.pdf")).toBe(true)
    expect(response.convertAvailable).toBe(true)
  })
})
