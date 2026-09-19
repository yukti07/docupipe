import { describe, expect, it } from "vitest"
import type { CellValue, TableRow } from "@/lib/api/types"
import {
  ARITY,
  OPERATORS,
  OPERATOR_LABELS,
  describeOperand,
  isBlank,
  matches,
  parseDate,
  parseList,
  parseNumber,
  unreadable,
} from "./filters"

const cell = (display: string, state: CellValue["state"] = "value"): CellValue => ({
  valueId: `val_${display || "none"}`,
  display,
  state,
})

describe("parseNumber", () => {
  it("reads a bare decimal, which is what the worker actually emits", () => {
    expect(parseNumber("1488.00")).toBe(1488)
  })

  it("reads a comma-grouped, dot-decimal amount", () => {
    expect(parseNumber("1,234.50")).toBe(1234.5)
  })

  it("reads a dot-grouped, comma-decimal amount", () => {
    expect(parseNumber("1.234,50")).toBe(1234.5)
  })

  it("reads a space-grouped, comma-decimal amount", () => {
    expect(parseNumber("1 234,50")).toBe(1234.5)
  })

  it("reads a narrow no-break space as a grouping separator", () => {
    expect(parseNumber("1 234,50")).toBe(1234.5)
  })

  it("strips the currency symbol rather than giving up on the value", () => {
    expect(parseNumber("$1,234.50")).toBe(1234.5)
    expect(parseNumber("€1.234,50")).toBe(1234.5)
    expect(parseNumber("₹1,234.50")).toBe(1234.5)
    expect(parseNumber("1234.50 USD")).toBe(1234.5)
  })

  it("treats a lone comma before three digits as grouping, not as a decimal point", () => {
    expect(parseNumber("1,234")).toBe(1234)
  })

  it("treats a lone comma before two digits as a decimal point", () => {
    expect(parseNumber("1,23")).toBe(1.23)
  })

  it("strips the percent sign without dividing — the column shows 12, so 12 is what filters", () => {
    expect(parseNumber("12%")).toBe(12)
  })

  it("reads parentheses as an accounting negative", () => {
    expect(parseNumber("(500)")).toBe(-500)
    expect(parseNumber("($1,234.50)")).toBe(-1234.5)
  })

  it("reads a leading minus", () => {
    expect(parseNumber("-500")).toBe(-500)
  })

  it("gives up on text that has digits but is not a number", () => {
    expect(parseNumber("INV-1044")).toBeNull()
  })

  it("gives up on a blank and on the placeholders a document uses for one", () => {
    expect(parseNumber("")).toBeNull()
    expect(parseNumber("   ")).toBeNull()
    expect(parseNumber("n/a")).toBeNull()
    expect(parseNumber("—")).toBeNull()
  })
})

describe("parseDate", () => {
  it("reads the ISO date the worker emits", () => {
    expect(parseDate("2026-01-01")).toBe(Date.UTC(2026, 0, 1))
  })

  it("reads a slash date day-first, which is the design's one guess", () => {
    expect(parseDate("03/04/2025")).toBe(Date.UTC(2025, 3, 3))
  })

  it("reads a dash date day-first too", () => {
    expect(parseDate("3-4-2025")).toBe(Date.UTC(2025, 3, 3))
  })

  it("reads a spelled-out month either way round", () => {
    expect(parseDate("3 Jan 2026")).toBe(Date.UTC(2026, 0, 3))
    expect(parseDate("Jan 3, 2026")).toBe(Date.UTC(2026, 0, 3))
    expect(parseDate("3 January 2026")).toBe(Date.UTC(2026, 0, 3))
  })

  it("gives up rather than letting Date guess", () => {
    expect(parseDate("soon")).toBeNull()
    expect(parseDate("")).toBeNull()
    expect(parseDate("2026-13-01")).toBeNull()
    expect(parseDate("32/01/2026")).toBeNull()
  })
})

describe("parseList", () => {
  it("splits on commas, semicolons and newlines", () => {
    expect(parseList("steel, copper; zinc\nlead")).toEqual(["steel", "copper", "zinc", "lead"])
  })

  it("drops the empties a trailing separator leaves behind", () => {
    expect(parseList("steel,,copper,")).toEqual(["steel", "copper"])
  })

  it("reads a blank as no items", () => {
    expect(parseList("")).toEqual([])
  })
})

describe("isBlank", () => {
  it("counts a missing cell and a not-found cell as blank", () => {
    expect(isBlank(undefined)).toBe(true)
    expect(isBlank(cell("", "not-found"))).toBe(true)
    expect(isBlank(cell("   "))).toBe(true)
  })

  it("does not count a marked cell as blank — it has a value a check flagged", () => {
    expect(isBlank(cell("216.40", "marked"))).toBe(false)
  })
})

describe("the operator sets", () => {
  it("offers comparisons on a number and not on text", () => {
    expect(OPERATORS.number).toContain("gt")
    expect(OPERATORS.text).not.toContain("gt")
  })

  it("offers contains on text and not on a number", () => {
    expect(OPERATORS.text).toContain("contains")
    expect(OPERATORS.number).not.toContain("contains")
  })

  it("gives currency the same operators as number", () => {
    expect(OPERATORS.currency).toEqual(OPERATORS.number)
  })

  it("labels every operator it offers, so a chip never renders a raw key", () => {
    for (const operators of Object.values(OPERATORS)) {
      for (const operator of operators) {
        expect(OPERATOR_LABELS[operator]).toBeTruthy()
      }
    }
  })

  it("asks for no value on the nullary operators and two on a range", () => {
    expect(ARITY.isEmpty).toBe(0)
    expect(ARITY.isYes).toBe(0)
    expect(ARITY.between).toBe(2)
    expect(ARITY.contains).toBe(1)
  })
})

describe("matches on text", () => {
  it("keeps a row that contains the text, case-insensitively", () => {
    expect(matches("text", cell("Ferro Castings Ltd"), { op: "contains", value: "ferro" })).toBe(
      true,
    )
    expect(matches("text", cell("Northgate Paper"), { op: "contains", value: "ferro" })).toBe(false)
  })

  it("keeps a row that does not contain the text", () => {
    expect(matches("text", cell("Northgate Paper"), { op: "notContains", value: "ferro" })).toBe(
      true,
    )
  })

  it("separates is from contains", () => {
    expect(matches("text", cell("INV-1044"), { op: "is", value: "INV-104" })).toBe(false)
    expect(matches("text", cell("INV-1044"), { op: "is", value: "inv-1044" })).toBe(true)
    expect(matches("text", cell("INV-1044"), { op: "isNot", value: "INV-1045" })).toBe(true)
  })
})

describe("matches on a number", () => {
  const total = cell("1,488.00")

  it("compares numerically rather than as text", () => {
    expect(matches("currency", total, { op: "gt", value: "1000" })).toBe(true)
    expect(matches("currency", total, { op: "gt", value: "2000" })).toBe(false)
    expect(matches("currency", total, { op: "lt", value: "2000" })).toBe(true)
  })

  it("does not match 100 against 1,488 the way contains would have", () => {
    expect(matches("currency", total, { op: "eq", value: "100" })).toBe(false)
    expect(matches("currency", cell("10.00"), { op: "gt", value: "100" })).toBe(false)
    expect(matches("currency", cell("216.40"), { op: "gt", value: "100" })).toBe(true)
  })

  it("includes the boundary on the or-equal operators and excludes it otherwise", () => {
    expect(matches("number", cell("100"), { op: "gte", value: "100" })).toBe(true)
    expect(matches("number", cell("100"), { op: "lte", value: "100" })).toBe(true)
    expect(matches("number", cell("100"), { op: "gt", value: "100" })).toBe(false)
    expect(matches("number", cell("100"), { op: "lt", value: "100" })).toBe(false)
  })

  it("parses the operand the same way it parses the cell", () => {
    expect(matches("currency", total, { op: "gt", value: "$1,000" })).toBe(true)
  })

  it("keeps a range inclusive at both ends", () => {
    expect(matches("number", cell("100"), { op: "between", value: "100", value2: "200" })).toBe(true)
    expect(matches("number", cell("200"), { op: "between", value: "100", value2: "200" })).toBe(true)
    expect(matches("number", cell("201"), { op: "between", value: "100", value2: "200" })).toBe(
      false,
    )
  })

  it("swaps a reversed range rather than matching nothing", () => {
    expect(matches("number", cell("150"), { op: "between", value: "200", value2: "100" })).toBe(true)
  })

  it("refuses an operand it cannot read, rather than matching every row", () => {
    expect(matches("number", cell("100"), { op: "gt", value: "abc" })).toBe(false)
  })
})

describe("matches on a date", () => {
  const invoiceDate = cell("2026-02-02")

  it("compares chronologically", () => {
    expect(matches("date", invoiceDate, { op: "after", value: "2026-01-15" })).toBe(true)
    expect(matches("date", invoiceDate, { op: "before", value: "2026-01-15" })).toBe(false)
    expect(matches("date", invoiceDate, { op: "on", value: "2026-02-02" })).toBe(true)
    expect(matches("date", invoiceDate, { op: "on", value: "2026-02-03" })).toBe(false)
  })

  it("keeps a date range inclusive at both ends", () => {
    expect(
      matches("date", invoiceDate, { op: "between", value: "2026-02-02", value2: "2026-03-01" }),
    ).toBe(true)
    expect(
      matches("date", invoiceDate, { op: "between", value: "2026-01-01", value2: "2026-02-02" }),
    ).toBe(true)
    expect(
      matches("date", invoiceDate, { op: "between", value: "2026-03-01", value2: "2026-04-01" }),
    ).toBe(false)
  })

  it("swaps a reversed date range", () => {
    expect(
      matches("date", invoiceDate, { op: "between", value: "2026-03-01", value2: "2026-01-01" }),
    ).toBe(true)
  })
})

describe("matches on yes/no", () => {
  it("reads the words and the digits a document uses for a boolean", () => {
    expect(matches("boolean", cell("yes"), { op: "isYes", value: "" })).toBe(true)
    expect(matches("boolean", cell("TRUE"), { op: "isYes", value: "" })).toBe(true)
    expect(matches("boolean", cell("1"), { op: "isYes", value: "" })).toBe(true)
    expect(matches("boolean", cell("no"), { op: "isNo", value: "" })).toBe(true)
    expect(matches("boolean", cell("false"), { op: "isNo", value: "" })).toBe(true)
  })

  it("matches neither when the text is not a yes or a no", () => {
    expect(matches("boolean", cell("maybe"), { op: "isYes", value: "" })).toBe(false)
    expect(matches("boolean", cell("maybe"), { op: "isNo", value: "" })).toBe(false)
  })
})

describe("matches on a list", () => {
  const materials = cell("steel, copper; zinc")

  it("matches a whole item and not a fragment of one", () => {
    expect(matches("list", materials, { op: "hasItem", value: "copper" })).toBe(true)
    expect(matches("list", materials, { op: "hasItem", value: "copp" })).toBe(false)
  })

  it("keeps a row missing the item", () => {
    expect(matches("list", materials, { op: "lacksItem", value: "lead" })).toBe(true)
    expect(matches("list", materials, { op: "lacksItem", value: "steel" })).toBe(false)
  })
})

describe("matches on a cell it cannot read", () => {
  it("excludes a not-found cell from every comparison", () => {
    const notFound = cell("", "not-found")
    expect(matches("currency", notFound, { op: "gt", value: "100" })).toBe(false)
    expect(matches("currency", notFound, { op: "lt", value: "100" })).toBe(false)
    expect(matches("text", notFound, { op: "contains", value: "a" })).toBe(false)
    expect(matches("text", notFound, { op: "notContains", value: "a" })).toBe(false)
  })

  it("finds that same cell with is empty, which is the only way to see it", () => {
    expect(matches("currency", cell("", "not-found"), { op: "isEmpty", value: "" })).toBe(true)
    expect(matches("currency", cell("1488.00"), { op: "isEmpty", value: "" })).toBe(false)
    expect(matches("currency", cell("1488.00"), { op: "isNotEmpty", value: "" })).toBe(true)
  })

  it("excludes a number cell holding unparsable text", () => {
    expect(matches("number", cell("see attached"), { op: "gt", value: "0" })).toBe(false)
  })

  it("treats a marked cell as the ordinary value it is", () => {
    expect(matches("currency", cell("216.40", "marked"), { op: "gt", value: "100" })).toBe(true)
  })
})

describe("unreadable", () => {
  const rows: TableRow[] = [
    { recordId: "r1", values: { total: cell("1488.00") } },
    { recordId: "r2", values: { total: cell("", "not-found") } },
    { recordId: "r3", values: { total: cell("see attached") } },
    { recordId: "r4", values: {} },
  ]

  it("counts the cells holding text it cannot read as a number", () => {
    expect(unreadable("currency", rows, "total")).toBe(1)
  })

  it("does not count the blanks — no value is a different fact from an unreadable one", () => {
    expect(unreadable("currency", [{ recordId: "r", values: {} }], "total")).toBe(0)
  })

  it("stays silent on the types with nothing to parse", () => {
    expect(unreadable("text", rows, "total")).toBe(0)
    expect(unreadable("list", rows, "total")).toBe(0)
    expect(unreadable("boolean", rows, "total")).toBe(0)
  })
})

describe("describeOperand", () => {
  it("reads one value plainly and a range as a pair", () => {
    expect(describeOperand({ op: "gt", value: "1000" })).toBe("1000")
    expect(describeOperand({ op: "between", value: "100", value2: "200" })).toBe("100 and 200")
  })

  it("says nothing for an operator that takes no value", () => {
    expect(describeOperand({ op: "isEmpty", value: "" })).toBe("")
  })
})
