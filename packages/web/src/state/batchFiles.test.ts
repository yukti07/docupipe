import { describe, expect, it } from "vitest"
import { forgetFiles, readRememberedFiles, rememberFiles } from "./batchFiles"

const file = (fileId: string, fileName: string) => ({
  fileId,
  fileName,
  fileLocation: fileName,
  size: 2048,
  filePath: `https://storage.example.test/${fileId}?X-Goog-Signature=abc`,
  expiresAt: "2026-09-14T11:05:00Z",
})

describe("remembered files", () => {
  it("keeps nothing before anything has landed", () => {
    expect(readRememberedFiles("req_1")).toEqual([])
  })

  it("remembers a confirmed upload across a reload", () => {
    rememberFiles("req_1", [file("file_1", "invoice-1043.pdf")])
    expect(readRememberedFiles("req_1")).toEqual([file("file_1", "invoice-1043.pdf")])
  })

  it("keeps the signed url, so the file is still addressable afterwards", () => {
    rememberFiles("req_1", [file("file_1", "invoice-1043.pdf")])
    expect(readRememberedFiles("req_1")[0].filePath).toMatch(/X-Goog-Signature/)
  })

  it("merges a second confirmation rather than replacing the first", () => {
    rememberFiles("req_1", [file("file_1", "a.pdf")])
    rememberFiles("req_1", [file("file_2", "b.pdf")])
    expect(readRememberedFiles("req_1").map((f) => f.fileId)).toEqual(["file_1", "file_2"])
  })

  it("keeps one batch's files out of another's", () => {
    rememberFiles("req_1", [file("file_1", "a.pdf")])
    rememberFiles("req_2", [file("file_9", "z.pdf")])
    expect(readRememberedFiles("req_1").map((f) => f.fileId)).toEqual(["file_1"])
  })

  it("empties the map when nothing in it could be shown", () => {
    localStorage.setItem(
      "quarry.batch.req_1.files",
      JSON.stringify([{ fileName: "orphan.pdf" }, { fileId: "", fileName: "also-orphan.pdf" }]),
    )
    expect(readRememberedFiles("req_1")).toEqual([])
    expect(localStorage.getItem("quarry.batch.req_1.files")).toBeNull()
  })

  it("survives a corrupt value", () => {
    localStorage.setItem("quarry.batch.req_1.files", "{not json")
    expect(readRememberedFiles("req_1")).toEqual([])
  })

  it("forgets on request", () => {
    rememberFiles("req_1", [file("file_1", "a.pdf")])
    forgetFiles("req_1")
    expect(readRememberedFiles("req_1")).toEqual([])
  })
})
