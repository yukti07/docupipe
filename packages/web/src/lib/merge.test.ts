import { describe, expect, it } from "vitest"
import type { SchemaField } from "@/lib/api/types"
import { isMergeId, mergeConflicts, shapeHash, shapeKey } from "./merge"

const f = (key: string, type: SchemaField["type"]): SchemaField => ({
  key,
  label: key,
  type,
  origin: "detected",
})

const TOTALS = [f("invoice_number", "text"), f("total", "currency")]

describe("shapeKey", () => {
  it("is the same for the same fields in a different order", () => {
    expect(shapeKey(TOTALS)).toBe(shapeKey([...TOTALS].reverse()))
    expect(shapeHash(TOTALS)).toBe(shapeHash([...TOTALS].reverse()))
  })

  it("changes when a field's type changes, not only its name", () => {
    const retyped = [f("invoice_number", "number"), f("total", "currency")]
    expect(shapeKey(retyped)).not.toBe(shapeKey(TOTALS))
  })

  it("ignores origin — an added field is still a field", () => {
    const added = TOTALS.map((field) => ({ ...field, origin: "added" as const }))
    expect(shapeKey(added)).toBe(shapeKey(TOTALS))
  })
})

describe("mergeConflicts", () => {
  const table = (schemaId: string, fields: SchemaField[]) => ({
    schemaId,
    tableName: `${schemaId}.pdf · table 1`,
    fields,
  })

  it("finds nothing wrong with tables that share a shape exactly", () => {
    expect(mergeConflicts([table("a", TOTALS), table("b", [...TOTALS].reverse())])).toEqual([])
  })

  it("names a type disagreement, and which tables are on each side", () => {
    const [conflict] = mergeConflicts([
      table("a", TOTALS),
      table("b", [f("invoice_number", "number"), f("total", "currency")]),
    ])
    expect(conflict.field).toBe("invoice_number")
    expect(conflict.groups.map((g) => g.type).sort()).toEqual(["number", "text"])
  })

  it("treats a field one table lacks as a conflict, not as something to widen", () => {
    const [conflict] = mergeConflicts([
      table("a", TOTALS),
      table("b", [f("invoice_number", "text")]),
    ])
    expect(conflict.field).toBe("total")
    expect(conflict.groups).toHaveLength(1)
  })

  it("names the type disagreement first, since it is the specific complaint", () => {
    const conflicts = mergeConflicts([
      table("a", TOTALS),
      table("b", [f("invoice_number", "number")]),
    ])
    expect(conflicts[0].field).toBe("invoice_number")
    expect(conflicts[0].groups).toHaveLength(2)
  })
})

describe("isMergeId", () => {
  it("tells a merge apart from a schema, which is how /api/table routes it", () => {
    expect(isMergeId("mrg_7QfB2a")).toBe(true)
    expect(isMergeId("sch_7QfB2a")).toBe(false)
  })
})
