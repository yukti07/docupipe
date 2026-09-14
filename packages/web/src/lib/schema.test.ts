import { describe, expect, it } from "vitest"
import type { SchemaField } from "@/lib/api/types"
import * as schema from "./schema"
import {
  addField,
  applyToAllTargets,
  changeFieldType,
  groupByOriginalShape,
  isEdited,
  shapeHash,
  validateNewField,
  type SchemaState,
} from "./schema"

const f = (key: string, type: SchemaField["type"]): SchemaField => ({
  key,
  label: key,
  type,
  origin: "detected",
})

const INVOICE = [f("invoice_number", "text"), f("invoice_date", "date"), f("total", "number")]

const state = (schemaId: string, fields: SchemaField[], current = fields): SchemaState => ({
  fileId: `file_${schemaId}`,
  fileName: `${schemaId}.pdf`,
  filePath: `requests/r/${schemaId}.pdf`,
  schemaId,
  tableLabel: "table 1",
  version: 1,
  original: fields,
  current,
})

describe("shapeHash", () => {
  it("is order-independent over (key, type)", () => {
    expect(shapeHash(INVOICE)).toBe(shapeHash([...INVOICE].reverse()))
  })

  it("changes when a type changes", () => {
    expect(shapeHash(INVOICE)).not.toBe(shapeHash(changeFieldType(INVOICE, "total", "currency")))
  })

  it("changes when a field is added", () => {
    expect(shapeHash(INVOICE)).not.toBe(shapeHash(addField(INVOICE, "supplier", "text")))
  })

  it("ignores the label, which is not part of the shape", () => {
    const relabelled = INVOICE.map((field) => ({ ...field, label: "Something else" }))
    expect(shapeHash(relabelled)).toBe(shapeHash(INVOICE))
  })
})

describe("applyToAllTargets", () => {
  it("matches on the original shape, not the current one", () => {
    const source = state("sch_1", INVOICE, changeFieldType(INVOICE, "total", "currency"))
    const sameOriginal = state("sch_2", INVOICE)
    const differentOriginal = state("sch_3", [f("a", "text")])

    const targets = applyToAllTargets([source, sameOriginal, differentOriginal], source)
    expect(targets.map((t) => t.schemaId)).toEqual(["sch_2"])
  })

  it("is order-independent — editing two schemas in either order hits the same files", () => {
    const a = state("sch_1", INVOICE, changeFieldType(INVOICE, "total", "currency"))
    const b = state("sch_2", INVOICE, addField(INVOICE, "supplier", "text"))
    const c = state("sch_3", INVOICE)

    expect(applyToAllTargets([a, b, c], a).map((t) => t.schemaId)).toEqual(["sch_2", "sch_3"])
    expect(applyToAllTargets([a, b, c], b).map((t) => t.schemaId)).toEqual(["sch_1", "sch_3"])
  })

  it("never includes the schema you are editing", () => {
    const source = state("sch_1", INVOICE)
    expect(applyToAllTargets([source], source)).toEqual([])
  })
})

describe("validateNewField", () => {
  it("rejects an empty name and says what to do", () => {
    expect(validateNewField("   ", INVOICE)).toEqual({ ok: false, reason: "Give the field a name." })
  })

  it("rejects a name that collides with a field already there", () => {
    const result = validateNewField("Invoice Number", INVOICE)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/already has a field called invoice_number/)
  })

  it("accepts a new name and hands back the key it will use", () => {
    expect(validateNewField("Supplier name", INVOICE)).toEqual({ ok: true, key: "supplier_name" })
  })

  it("rejects a name with nothing usable in it", () => {
    expect(validateNewField("///", INVOICE).ok).toBe(false)
  })
})

describe("the two edits, and only the two", () => {
  it("changes a field's type in place", () => {
    const next = changeFieldType(INVOICE, "total", "currency")
    expect(next.find((field) => field.key === "total")?.type).toBe("currency")
    expect(next).toHaveLength(INVOICE.length)
  })

  it("marks an added field as added by you", () => {
    const next = addField(INVOICE, "Supplier", "text")
    expect(next.at(-1)).toMatchObject({ key: "supplier", label: "Supplier", origin: "added" })
  })

  it("exposes no rename and no delete to call", () => {
    const names = Object.keys(schema)
    expect(names.some((n) => /rename/i.test(n))).toBe(false)
    expect(names.some((n) => /(delete|remove|drop)/i.test(n))).toBe(false)
  })
})

describe("isEdited", () => {
  it("is false until something actually changes", () => {
    expect(isEdited(state("sch_1", INVOICE))).toBe(false)
    expect(isEdited(state("sch_1", INVOICE, changeFieldType(INVOICE, "total", "currency")))).toBe(
      true,
    )
  })
})

describe("groupByOriginalShape", () => {
  it("puts identical original shapes together, biggest group first", () => {
    const groups = groupByOriginalShape([
      state("sch_1", INVOICE),
      state("sch_2", [f("a", "text")]),
      state("sch_3", INVOICE),
    ])
    expect(groups[0].schemas.map((s) => s.schemaId)).toEqual(["sch_1", "sch_3"])
    expect(groups[1].schemas.map((s) => s.schemaId)).toEqual(["sch_2"])
  })
})
