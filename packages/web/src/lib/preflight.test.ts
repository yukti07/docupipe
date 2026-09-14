import { describe, expect, it } from "vitest"
import {
  MAX_UPLOAD_BYTES,
  acceptedFiles,
  preflight,
  rejectedFiles,
  stageFiles,
} from "./preflight"

const fileOf = (name: string, size: number): File => {
  const file = new File(["x"], name)
  Object.defineProperty(file, "size", { value: size })
  return file
}

describe("preflight", () => {
  it("passes a plain PDF", () => {
    expect(preflight(fileOf("invoice-1044.pdf", 2048))).toBeUndefined()
  })

  it("rejects an empty file", () => {
    expect(preflight(fileOf("nothing.pdf", 0))?.class).toBe("empty_file")
  })

  it("rejects a file past the cap and says what the cap is", () => {
    const failure = preflight(fileOf("huge.pdf", MAX_UPLOAD_BYTES + 1))
    expect(failure?.class).toBe("too_large")
    expect(failure?.message).toMatch(/The limit is 50 MB/)
  })

  it("rejects a zip with the reason, rather than expanding it in the browser", () => {
    const failure = preflight(fileOf("q3-archive.zip", 4096))
    expect(failure?.class).toBe("archive_not_expanded")
    expect(failure?.message).toMatch(/unzip it first/i)
  })

  it("rejects an extension we have no reader for", () => {
    const failure = preflight(fileOf("drawing.dwg", 4096))
    expect(failure?.class).toBe("format_unsupported")
    expect(failure?.message).toMatch(/\.dwg/)
  })

  it("accepts the formats the product claims to read", () => {
    for (const name of [
      "notes.txt", "sheet.xlsx", "rows.csv", "records.json", "letter.docx",
      "scan-0091.png", "call-0912.m4a",
    ]) {
      expect(preflight(fileOf(name, 1024)), name).toBeUndefined()
    }
  })
})

describe("stageFiles", () => {
  it("keeps the good files when one is bad — a bad file never rejects the drop", () => {
    const staged = stageFiles([
      fileOf("a.pdf", 1024),
      fileOf("archive.zip", 1024),
      fileOf("b.pdf", 1024),
    ])
    expect(staged).toHaveLength(3)
    expect(acceptedFiles(staged).map((s) => s.name)).toEqual(["a.pdf", "b.pdf"])
    expect(rejectedFiles(staged)).toHaveLength(1)
  })

  it("gives every staged file its own id, so a retry cannot hit the wrong row", () => {
    const staged = stageFiles([fileOf("a.pdf", 1), fileOf("a.pdf", 1)])
    expect(staged[0].localId).not.toBe(staged[1].localId)
  })

  it("carries the folder path for a folder drop, and the plain name otherwise", () => {
    const inFolder = fileOf("invoice-1043.pdf", 1024)
    Object.defineProperty(inFolder, "webkitRelativePath", {
      value: "Q3 invoices/invoice-1043.pdf",
    })
    const [folder, plain] = stageFiles([inFolder, fileOf("loose.pdf", 1024)])
    expect(folder.location).toBe("Q3 invoices/invoice-1043.pdf")
    expect(plain.location).toBe("loose.pdf")
  })
})
