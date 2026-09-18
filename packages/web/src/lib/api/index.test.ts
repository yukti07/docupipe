import { describe, expect, it } from "vitest"
import { FixtureApi } from "./fixtures"
import { api } from "./index"
import { NotBuilt } from "./live"

describe("the surfaces with no route yet", () => {
  it("refuses rather than serving sample rows under a real batch", async () => {
    // What the app does without the fixture fallback, which is the default
    // everywhere except this suite.
    await expect(NotBuilt.getRawText("req_1", "sch_32")).rejects.toMatchObject({
      failure: { class: "not_implemented" },
    })
    await expect(NotBuilt.getEvidence("val_r5_vat")).rejects.toMatchObject({
      failure: { class: "not_implemented" },
    })
  })
})

describe("the fixture table", () => {
  it("serves a table from the fixture set", async () => {
    const table = await FixtureApi.getTable("req_1", "sch_32")
    expect(table.fileName).toBe("invoice-1044.pdf")
    expect(table.rows).toHaveLength(22)
  })

  it("marks the vat cell on row 5 with its reason", async () => {
    const table = await FixtureApi.getTable("req_1", "sch_32")
    const cell = table.rows[4].values.vat
    expect(cell.state).toBe("marked")
    expect(cell.reason).toMatch(/216\.40/)
  })

  it("reports a whole row that could not be read", async () => {
    const table = await FixtureApi.getTable("req_1", "sch_32")
    expect(table.rows[6].failed?.message).toMatch(/cut off at the right edge/i)
  })
})

describe("the composed api", () => {
  it("returns a page locator with fractional box coordinates", async () => {
    const evidence = await api.getEvidence("val_r5_vat")
    expect(evidence.locator.type).toBe("page")
    if (evidence.locator.type === "page") {
      expect(evidence.locator.box.x).toBeGreaterThan(0)
      expect(evidence.locator.box.x).toBeLessThan(1)
    }
  })

  it("refuses an exact-match merge across differing schemas", async () => {
    const result = await FixtureApi.createMerges("user_1", "req_1", [
      { name: "August", schemaIds: ["sch_totals_a", "sch_lines_b"] },
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.conflicts[0].field).toBeTruthy()
  })

  it("names the type disagreement first, since it is the specific complaint", async () => {
    const result = await FixtureApi.createMerges("user_1", "req_1", [
      { name: "August", schemaIds: ["sch_totals_a", "sch_lines_b"] },
    ])
    if (result.ok) throw new Error("expected the merge to be refused")
    expect(result.conflicts[0].field).toBe("invoice_number")
    expect(result.conflicts[0].groups.map((g) => g.type).sort()).toEqual(["number", "text"])
  })

  it("allows a merge across tables that share a shape exactly", async () => {
    const result = await FixtureApi.createMerges("user_1", "req_1", [
      { name: "August", schemaIds: ["sch_31", "sch_totals_a"] },
    ])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.merges[0].rowCount).toBeGreaterThan(0)
    // A merge takes its members out of the list and puts one table back.
    if (result.ok) await FixtureApi.deleteMerge("user_1", "req_1", result.merges[0].mergeId)
  })

  it("carries several groups in one submit, each into its own table", async () => {
    const result = await FixtureApi.createMerges("user_1", "req_1", [
      { name: "Totals", schemaIds: ["sch_31", "sch_totals_a"] },
      { name: "Lines", schemaIds: ["sch_lines_b", "sch_lines_c"] },
    ])
    if (!result.ok) throw new Error("expected both merges to be written")
    expect(result.merges.map((m) => m.name)).toEqual(["Totals", "Lines"])

    // And the members are gone from what the picker may offer next.
    const overview = await FixtureApi.getMergeOverview("req_1")
    const offered = overview.groups.flatMap((g) => g.members.map((m) => m.schemaId))
    expect(offered).not.toContain("sch_31")
    expect(offered).not.toContain("sch_lines_b")
    expect(overview.merges).toHaveLength(2)

    for (const merge of result.merges) await FixtureApi.deleteMerge("user_1", "req_1", merge.mergeId)
  })

  it("opens a merged table as its members' rows, each saying where it came from", async () => {
    const result = await FixtureApi.createMerges("user_1", "req_1", [
      { name: "Lines", schemaIds: ["sch_lines_b", "sch_lines_c"] },
    ])
    if (!result.ok) throw new Error("expected the merge to be written")

    const table = await FixtureApi.getTable("req_1", result.merges[0].mergeId)
    expect(table.merged).toBe(true)
    expect(table.rows).toHaveLength(result.merges[0].rowCount)
    expect(new Set(table.rows.map((row) => row.sourceFile)).size).toBe(2)

    await FixtureApi.deleteMerge("user_1", "req_1", result.merges[0].mergeId)
  })

  it("opens evidence for a cell we have no locator for, and says so plainly", async () => {
    const evidence = await api.getEvidence("val_made_up_value")
    expect(evidence.locator.type).toBe("none")
    if (evidence.locator.type === "none") {
      expect(evidence.locator.reason.length).toBeGreaterThan(10)
    }
  })
})
