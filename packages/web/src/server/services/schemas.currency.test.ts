import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A currency column carries which currency it is in, and the server decides
 * what that is allowed to be.
 *
 * The rule is not a data check — nothing here looks at a single amount. It is
 * a check on the CLAIM: a code only means something on a column of amounts,
 * and only a code the worker can actually read is worth persisting, because
 * the coercer strips exactly this list before it parses a figure.
 */

const getRequest = vi.fn()
const getSchemaForUser = vi.fn()
const updateSchemaFields = vi.fn()
const recordEvent = vi.fn()

vi.mock("../db/client", () => ({
  transaction: (fn: (tx: unknown) => unknown) => fn({}),
}))

vi.mock("../db/repos", () => ({
  getRequest: (...a: unknown[]) => getRequest(...a),
  getSchemaForUser: (...a: unknown[]) => getSchemaForUser(...a),
  updateSchemaFields: (...a: unknown[]) => updateSchemaFields(...a),
  recordEvent: (...a: unknown[]) => recordEvent(...a),
}))

const { updateSchemas } = await import("./schemas")

const ORIGINAL = [
  { key: "invoice_number", label: "invoice_number", type: "text", origin: "detected" },
  { key: "total", label: "total", type: "currency", origin: "detected" },
]

/** The fields `updateSchemaFields` was handed, which is what would be stored. */
const saved = () => updateSchemaFields.mock.calls[0][2]

const save = (fields: Record<string, unknown>[]) =>
  updateSchemas("u1", "R1", [
    {
      fileId: "F1",
      fileName: "invoice-1044.pdf",
      filePath: "requests/R1/invoice-1044.pdf",
      schemaId: "sch_1",
      // The wire shape is looser than SchemaField on purpose: this is the
      // request body, and the point of these tests is what it may contain.
      schema: { fields },
    },
  ] as never)

beforeEach(() => {
  getRequest.mockReset().mockResolvedValue({ id: "R1", converted_at: null })
  getSchemaForUser.mockReset().mockResolvedValue({
    id: "sch_1",
    request_id: "R1",
    file_id: "F1",
    shape_hash: "abc",
    original_fields: ORIGINAL,
  })
  updateSchemaFields.mockReset().mockResolvedValue(2)
  recordEvent.mockReset().mockResolvedValue(undefined)
})

describe("the currency on a saved schema", () => {
  it("is carried through on a currency field", async () => {
    await save([ORIGINAL[0], { ...ORIGINAL[1], currency: "EUR" }])
    expect(saved()[1].currency).toBe("EUR")
  })

  it("is stripped from a field that does not hold amounts", async () => {
    // Not an error — the editor already clears it on a retype, and refusing
    // the save would only turn a stale key into a dead end.
    await save([{ ...ORIGINAL[0], currency: "USD" }, ORIGINAL[1]])
    expect(saved()[0]).not.toHaveProperty("currency")
  })

  it("is stripped when the field is retyped away from currency in the same save", async () => {
    await save([ORIGINAL[0], { ...ORIGINAL[1], type: "text", currency: "EUR" }])
    expect(saved()[1]).not.toHaveProperty("currency")
  })

  it("is absent, not null, on a currency column nobody has marked", async () => {
    await save(ORIGINAL)
    expect(saved()[1]).not.toHaveProperty("currency")
  })

  it("refuses a code the worker cannot read, rather than quietly dropping it", async () => {
    // Dropping it would store a schema that disagrees with the one submitted,
    // and the disagreement is invisible until a column of CHF comes back raw.
    await expect(save([ORIGINAL[0], { ...ORIGINAL[1], currency: "CHF" }])).rejects.toThrow(/CHF/)
    expect(updateSchemaFields).not.toHaveBeenCalled()
  })
})
