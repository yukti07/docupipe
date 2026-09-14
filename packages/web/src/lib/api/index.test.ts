import { describe, expect, it } from "vitest"
import { api } from "./index"

describe("the composed api", () => {
  it("serves a table from the fixture set", async () => {
    const table = await api.getTable("req_1", "sch_32")
    expect(table.fileName).toBe("invoice-1044.pdf")
    expect(table.rows).toHaveLength(22)
  })

  it("marks the vat cell on row 5 with its reason", async () => {
    const table = await api.getTable("req_1", "sch_32")
    const cell = table.rows[4].values.vat
    expect(cell.state).toBe("marked")
    expect(cell.reason).toMatch(/216\.40/)
  })

  it("reports a whole row that could not be read", async () => {
    const table = await api.getTable("req_1", "sch_32")
    expect(table.rows[6].failed?.message).toMatch(/cut off at the right edge/i)
  })

  it("returns a page locator with fractional box coordinates", async () => {
    const evidence = await api.getEvidence("val_r5_vat")
    expect(evidence.locator.type).toBe("page")
    if (evidence.locator.type === "page") {
      expect(evidence.locator.box.x).toBeGreaterThan(0)
      expect(evidence.locator.box.x).toBeLessThan(1)
    }
  })

  it("refuses an exact-match merge across differing schemas", async () => {
    const result = await api.createMerge("req_1", ["sch_totals_a", "sch_lines_b"], "August")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.conflicts[0].field).toBeTruthy()
  })

  it("names the type disagreement first, since it is the specific complaint", async () => {
    const result = await api.createMerge("req_1", ["sch_totals_a", "sch_lines_b"], "August")
    if (result.ok) throw new Error("expected the merge to be refused")
    expect(result.conflicts[0].field).toBe("invoice_number")
    expect(result.conflicts[0].groups.map((g) => g.type).sort()).toEqual(["number", "text"])
  })

  it("allows a merge across tables that share a shape exactly", async () => {
    const result = await api.createMerge("req_1", ["sch_31", "sch_totals_a"], "August")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.rowCount).toBeGreaterThan(0)
  })

  it("opens evidence for a cell we have no locator for, and says so plainly", async () => {
    const evidence = await api.getEvidence("val_made_up_value")
    expect(evidence.locator.type).toBe("none")
    if (evidence.locator.type === "none") {
      expect(evidence.locator.reason.length).toBeGreaterThan(10)
    }
  })
})
