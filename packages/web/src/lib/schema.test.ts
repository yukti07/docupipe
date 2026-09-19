import { describe, expect, it } from "vitest"
import type { SchemaField } from "@/lib/api/types"
import * as schema from "./schema"
import {
  addField,
  allShapesSettled,
  partitionFailures,
  changeFieldType,
  groupByCurrentShape,
  isEdited,
  shapeHash,
  updateTargetsFor,
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

describe("updateTargetsFor", () => {
  it("offers the tables carrying exactly these field names", () => {
    const source = state("sch_1", INVOICE, changeFieldType(INVOICE, "total", "currency"))
    const same = state("sch_2", INVOICE)
    const unrelated = state("sch_3", [f("a", "text")])

    const targets = updateTargetsFor([source, same, unrelated], source)
    expect(targets.map((t) => t.schema.schemaId)).toEqual(["sch_2"])
    expect(targets[0].added).toEqual([])
  })

  it("offers a table short of one field, and names the field it would gain", () => {
    const source = state("sch_1", INVOICE)
    const short = state("sch_2", [f("invoice_number", "text"), f("invoice_date", "date")])

    const targets = updateTargetsFor([source, short], source)
    expect(targets.map((t) => t.schema.schemaId)).toEqual(["sch_2"])
    expect(targets[0].added).toEqual(["total"])
  })

  it("leaves out a table short of two", () => {
    const source = state("sch_1", INVOICE)
    const short = state("sch_2", [f("invoice_number", "text")])
    expect(updateTargetsFor([source, short], source)).toEqual([])
  })

  it("leaves out a table holding a field this schema does not — that write would drop it", () => {
    const source = state("sch_1", INVOICE)
    const wider = state("sch_2", addField(INVOICE, "supplier", "text"))
    expect(updateTargetsFor([source, wider], source)).toEqual([])
  })

  it("matches on the fields as they are now, which is what the push would write", () => {
    // sch_2 was read with two fields and has since gained the third by hand,
    // so it is an exact match today whatever its document said.
    const source = state("sch_1", INVOICE)
    const grown = state(
      "sch_2",
      [f("invoice_number", "text"), f("invoice_date", "date")],
      INVOICE,
    )
    expect(updateTargetsFor([source, grown], source)[0].added).toEqual([])
  })

  it("puts the exact matches first", () => {
    const source = state("sch_1", INVOICE)
    const short = state("sch_2", [f("invoice_number", "text"), f("invoice_date", "date")])
    const exact = state("sch_3", INVOICE)

    expect(updateTargetsFor([source, short, exact], source).map((t) => t.schema.schemaId)).toEqual([
      "sch_3",
      "sch_2",
    ])
  })

  it("never includes the schema you are editing", () => {
    const source = state("sch_1", INVOICE)
    expect(updateTargetsFor([source], source)).toEqual([])
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

  it("still says so after a reload, when the edit is only in the version", () => {
    // What comes back from the server on a fresh screen: the saved fields as
    // both the original and the current shape, and a version past its first.
    const saved = changeFieldType(INVOICE, "total", "currency")
    expect(isEdited({ ...state("sch_1", saved), version: 2 })).toBe(true)
  })
})

describe("groupByCurrentShape", () => {
  it("puts identical shapes together, biggest group first", () => {
    const groups = groupByCurrentShape([
      state("sch_1", INVOICE),
      state("sch_2", [f("a", "text")]),
      state("sch_3", INVOICE),
    ])
    expect(groups[0].schemas.map((s) => s.schemaId)).toEqual(["sch_1", "sch_3"])
    expect(groups[1].schemas.map((s) => s.schemaId)).toEqual(["sch_2"])
  })

  it("groups on the shape a table has now, not the one it came with", () => {
    const edited = state("sch_2", INVOICE, changeFieldType(INVOICE, "total", "currency"))
    expect(groupByCurrentShape([state("sch_1", INVOICE), edited])).toHaveLength(2)
  })
})

describe("allShapesSettled", () => {
  const shape = (fileId: string) => ({ fileId })

  it("is false while a file has neither a shape nor a reason it has none", () => {
    expect(allShapesSettled([shape("f1")], [], 3)).toBe(false)
  })

  it("counts a file that could not give up a shape as settled", () => {
    expect(allShapesSettled([shape("f1")], [shape("f2")], 2)).toBe(true)
  })

  it("counts a file once however many tables it gave up", () => {
    expect(allShapesSettled([shape("f1"), shape("f1"), shape("f1")], [], 2)).toBe(false)
  })

  it("is false before any file has been accepted, rather than vacuously true", () => {
    expect(allShapesSettled([], [], 0)).toBe(false)
  })
})

describe("partitionFailures", () => {
  const entry = (fileId: string, schemaId: string | null, cls = "extract_empty") =>
    ({
      fileId,
      fileName: `${fileId}.xlsx`,
      filePath: "",
      schemaId,
      status: "failed" as const,
      schema: null,
      failure: { class: cls as "extract_empty", message: "nothing in it" },
    })

  const ready = (fileId: string, schemaId: string) =>
    ({
      fileId,
      fileName: `${fileId}.xlsx`,
      filePath: "",
      schemaId,
      status: "ready" as const,
      schema: { tableOrd: 0, tableLabel: "Sheet", version: 1, shapeHash: "h", matchingFileCount: 1, fields: [] },
    })

  it("keeps a failure that names no table as a failure of the whole file", () => {
    const { files, tables } = partitionFailures([entry("f1", null)])
    expect(files.map((f) => f.fileId)).toEqual(["f1"])
    expect(tables).toEqual([])
  })

  it("keeps a failure that names a table as a failure of that table alone", () => {
    const { files, tables } = partitionFailures([entry("f1", "sch_1")])
    expect(files).toEqual([])
    expect(tables.map((t) => t.schemaId)).toEqual(["sch_1"])
  })

  it("separates the empty worksheet of a workbook from its readable ones", () => {
    const { files, tables } = partitionFailures([
      ready("f1", "sch_0"),
      entry("f1", "sch_1"),
      ready("f1", "sch_2"),
    ])
    // The workbook itself converts. Only one of its sheets gave nothing.
    expect(files).toEqual([])
    expect(tables.map((t) => t.schemaId)).toEqual(["sch_1"])
  })

  it("ignores entries that did not fail", () => {
    expect(partitionFailures([ready("f1", "sch_0")])).toEqual({ files: [], tables: [] })
  })
})
