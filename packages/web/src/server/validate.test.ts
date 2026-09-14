import { describe, expect, it } from "vitest"

import { ApiFailure } from "./failures"
import {
  array,
  contentTypeFor,
  extensionOf,
  requestId,
  safeFilename,
  userId,
} from "./validate"

describe("userId", () => {
  it("accepts what lib/session.ts generates", () => {
    // usr_ + 22 base64url chars = 26, inside the {22,64} the CHECK constraint
    // on users.id allows.
    const generated = "usr_YWJjZGVmZ2hpamtsbW5vcA"
    expect(userId({ userId: generated })).toBe(generated)
  })

  it("refuses an id short enough to be guessable", () => {
    // The id is a bearer capability — whoever holds it holds the workspace —
    // so its entropy is the whole security control.
    expect(() => userId({ userId: "usr_1" })).toThrow(ApiFailure)
  })

  it("refuses characters that are not base64url", () => {
    expect(() => userId({ userId: "usr_" + "a".repeat(20) + "/=" })).toThrow(ApiFailure)
  })

  it("refuses a missing id", () => {
    expect(() => userId({})).toThrow(ApiFailure)
  })
})

describe("requestId", () => {
  it("accepts what lib/session.ts generates", () => {
    const generated = "req_YWJjZGVmZ2hpam"
    expect(requestId({ requestId: generated })).toBe(generated)
  })

  it("refuses one too short for the CHECK constraint", () => {
    expect(() => requestId({ requestId: "req_1" })).toThrow(ApiFailure)
  })
})

describe("safeFilename", () => {
  it("keeps an ordinary name intact", () => {
    expect(safeFilename("invoice-1043.pdf")).toBe("invoice-1043.pdf")
  })

  it("strips a path, whichever separator was used", () => {
    expect(safeFilename("Q3 invoices/invoice-1043.pdf")).toBe("invoice-1043.pdf")
    expect(safeFilename("C:\\Users\\me\\invoice.pdf")).toBe("invoice.pdf")
  })

  it("defuses traversal", () => {
    // Not "../../etc/passwd" landing anywhere near the object key.
    expect(safeFilename("../../etc/passwd")).toBe("passwd")
    expect(safeFilename("..")).toBe("file")
  })

  it("never returns an empty name", () => {
    expect(safeFilename("")).toBe("file")
    expect(safeFilename("...")).toBe("file")
  })

  it("replaces anything exotic rather than dropping the file", () => {
    expect(safeFilename("faktúra №5.pdf")).toMatch(/^[A-Za-z0-9._ -]+$/)
  })

  it("caps the length", () => {
    expect(safeFilename("a".repeat(400) + ".pdf").length).toBeLessThanOrEqual(100)
  })
})

describe("contentTypeFor", () => {
  it("maps the formats the drop zone advertises", () => {
    expect(contentTypeFor("a.pdf")).toBe("application/pdf")
    expect(contentTypeFor("a.csv")).toBe("text/csv")
    expect(contentTypeFor("a.XLSX")).toContain("spreadsheetml")
  })

  it("falls back rather than guessing", () => {
    expect(contentTypeFor("a.dwg")).toBe("application/octet-stream")
    expect(contentTypeFor("noextension")).toBe("application/octet-stream")
  })

  it("reads the last extension", () => {
    expect(extensionOf("report.final.pdf")).toBe("pdf")
  })
})

describe("array", () => {
  it("refuses a non-array", () => {
    expect(() => array({ files: "nope" }, "files")).toThrow(ApiFailure)
  })

  it("refuses an empty drop", () => {
    expect(() => array({ files: [] }, "files", { min: 1 })).toThrow(ApiFailure)
  })

  it("caps how many files one call can carry", () => {
    const many = Array.from({ length: 10 }, (_, i) => `f${i}.pdf`)
    expect(() => array({ files: many }, "files", { max: 5 })).toThrow(ApiFailure)
  })
})
