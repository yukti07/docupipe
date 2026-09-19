import type { CellValue, FieldType, TableRow } from "@/lib/api/types"

/**
 * What a column filter can ask, and how to answer it against a cell.
 *
 * A cell arrives as `display: string` and nothing else — there is no normalized
 * number or date on the wire, and no server-side filtering endpoint. Every
 * comparison therefore parses the displayed text here, which is why this module
 * is mostly parsers. They are deliberately wider than the fixture: a merged
 * table unions several files, and a field's type can be changed by hand after
 * inference, so the text under a `currency` column is not always the bare
 * decimal the worker emits.
 */

export type Operator =
  | "contains"
  | "notContains"
  | "is"
  | "isNot"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "eq"
  | "after"
  | "before"
  | "on"
  | "between"
  | "isYes"
  | "isNo"
  | "hasItem"
  | "lacksItem"
  | "isEmpty"
  | "isNotEmpty"

/** An object, not a string, so the operator survives into the chip row. */
export type ColumnFilterValue = {
  op: Operator
  /** Empty when the operator takes no value. */
  value: string
  /** The upper bound; read only when the operator is `between`. */
  value2?: string
}

const NUMERIC_OPERATORS: readonly Operator[] = ["gt", "lt", "gte", "lte", "eq", "between", "isEmpty"]

/** Each type's operators, in the order the menu lists them. The first is the default. */
export const OPERATORS: Record<FieldType, readonly Operator[]> = {
  text: ["contains", "notContains", "is", "isNot", "isEmpty", "isNotEmpty"],
  number: NUMERIC_OPERATORS,
  currency: NUMERIC_OPERATORS,
  date: ["after", "before", "on", "between", "isEmpty"],
  boolean: ["isYes", "isNo", "isEmpty"],
  list: ["hasItem", "lacksItem", "isEmpty"],
}

/** The operator menu and the active-filter chip both read these, so they cannot drift. */
export const OPERATOR_LABELS: Record<Operator, string> = {
  contains: "contains",
  notContains: "does not contain",
  is: "is",
  isNot: "is not",
  gt: "is greater than",
  lt: "is less than",
  gte: "is at least",
  lte: "is at most",
  eq: "equals",
  after: "is after",
  before: "is before",
  on: "is on",
  between: "is between",
  isYes: "is yes",
  isNo: "is no",
  hasItem: "has item",
  lacksItem: "does not have item",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
}

/** How many values the operator needs — what decides the inputs the popover renders. */
export const ARITY: Record<Operator, 0 | 1 | 2> = {
  contains: 1,
  notContains: 1,
  is: 1,
  isNot: 1,
  gt: 1,
  lt: 1,
  gte: 1,
  lte: 1,
  eq: 1,
  after: 1,
  before: 1,
  on: 1,
  between: 2,
  isYes: 0,
  isNo: 0,
  hasItem: 1,
  lacksItem: 1,
  isEmpty: 0,
  isNotEmpty: 0,
}

/** True when the operator has every value it needs to mean anything. */
export function isApplied(filter: ColumnFilterValue): boolean {
  const arity = ARITY[filter.op]
  if (arity === 0) return true
  if (filter.value.trim() === "") return false
  return arity === 1 || (filter.value2 ?? "").trim() !== ""
}

/**
 * The number a cell shows, or null when it shows something that is not one.
 *
 * Percent is stripped rather than divided: the column reads 12, so 12 is what
 * "greater than 10" has to compare against.
 */
export function parseNumber(display: string): number | null {
  let text = display.trim()
  if (text === "") return null

  let negative = false
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true
    text = text.slice(1, -1).trim()
  }

  // A currency code stands apart from the digits; a letter run touching them
  // (INV-1044) is part of an identifier, and identifiers are not numbers.
  text = text
    .replace(/^\p{L}{2,3}(?=\s)/u, "")
    .replace(/(?<=\s)\p{L}{2,3}$/u, "")
    .trim()
  text = text.replace(/[\p{Sc}%]/gu, "").trim()

  if (text.startsWith("-")) {
    negative = true
    text = text.slice(1).trim()
  } else if (text.startsWith("+")) {
    text = text.slice(1).trim()
  }

  text = text.replace(/\s/g, "")
  if (!/^[\d.,]+$/.test(text) || !/\d/.test(text)) return null

  text = resolveSeparators(text)
  const value = Number(text)
  if (!Number.isFinite(value)) return null
  return negative ? -value : value
}

/**
 * Which of `.` and `,` groups and which one is the decimal point.
 *
 * With both present the rightmost is the decimal point. With one present it is
 * a decimal point only when it splits the text once and leaves one or two
 * digits behind it — so `1,234` is a thousand and `1,23` is one and a bit. That
 * is a guess in the genuinely ambiguous case, and a wrong guess costs one
 * filter rather than a wrong total.
 */
function resolveSeparators(text: string): string {
  const comma = text.lastIndexOf(",")
  const dot = text.lastIndexOf(".")

  if (comma >= 0 && dot >= 0) {
    const [decimal, group] = comma > dot ? [",", "."] : [".", ","]
    return text.split(group).join("").replace(decimal, ".")
  }

  const separator = comma >= 0 ? "," : dot >= 0 ? "." : null
  if (!separator) return text

  const parts = text.split(separator)
  const decimal = parts.length === 2 && parts[1].length >= 1 && parts[1].length <= 2
  return parts.join(decimal ? "." : "")
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
]

/**
 * A cell's date as a UTC midnight timestamp, so two dates compare without a
 * timezone shifting one of them across a day boundary.
 *
 * `Date` is never used as a fallback: it reads a slash date month-first, which
 * would contradict the day-first rule below. The filter's own operand comes
 * from an `<input type="date">` and so is always ISO — only the cell can be
 * misread, and only when the worker emits a slash date at all.
 */
export function parseDate(display: string): number | null {
  const text = display.trim()
  if (text === "") return null

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  if (iso) return utc(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const dayFirst = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text)
  if (dayFirst) return utc(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]))

  const dayMonth = /^(\d{1,2})\s+(\p{L}+),?\s+(\d{4})$/u.exec(text)
  if (dayMonth) return named(dayMonth[3], dayMonth[2], dayMonth[1])

  const monthDay = /^(\p{L}+)\s+(\d{1,2}),?\s+(\d{4})$/u.exec(text)
  if (monthDay) return named(monthDay[3], monthDay[1], monthDay[2])

  return null
}

function named(year: string, month: string, day: string): number | null {
  const index = MONTHS.indexOf(month.slice(0, 3).toLowerCase())
  if (index < 0) return null
  return utc(Number(year), index + 1, Number(day))
}

/** Rejects a date that does not exist, rather than letting it roll into the next month. */
function utc(year: number, month: number, day: number): number | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const stamp = Date.UTC(year, month - 1, day)
  const date = new Date(stamp)
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return stamp
}

/** The items in a list cell. Separators vary by document, so all three are read. */
export function parseList(display: string): string[] {
  return display
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter((item) => item !== "")
}

/** Reads the words and the digits a document uses for a yes or a no. */
function parseBoolean(display: string): boolean | null {
  const text = display.trim().toLowerCase()
  if (["yes", "y", "true", "1", "✓"].includes(text)) return true
  if (["no", "n", "false", "0"].includes(text)) return false
  return null
}

/**
 * Whether the cell holds no value at all.
 *
 * A marked cell is not blank: it has a value that an automatic check flagged,
 * and it takes part in comparisons like any other.
 */
export function isBlank(value: CellValue | undefined): boolean {
  if (!value) return true
  if (value.state === "not-found") return true
  return value.display.trim() === ""
}

/**
 * Whether the cell passes the filter.
 *
 * `isEmpty` and `isNotEmpty` answer from blankness alone and never parse.
 * Every other operator excludes a blank cell, and the comparison operators
 * also exclude a cell whose text cannot be read as the column's own type —
 * which is what `unreadable` below exists to warn about.
 */
export function matches(
  type: FieldType,
  value: CellValue | undefined,
  filter: ColumnFilterValue,
): boolean {
  const blank = isBlank(value)
  if (filter.op === "isEmpty") return blank
  if (filter.op === "isNotEmpty") return !blank
  if (blank || !value) return false

  const display = value.display.trim()

  switch (type) {
    case "number":
    case "currency":
      return matchesNumber(display, filter)
    case "date":
      return matchesDate(display, filter)
    case "boolean":
      return matchesBoolean(display, filter)
    case "list":
      return matchesList(display, filter)
    default:
      return matchesText(display, filter)
  }
}

function matchesText(display: string, filter: ColumnFilterValue): boolean {
  const cell = display.toLowerCase()
  const operand = filter.value.trim().toLowerCase()

  switch (filter.op) {
    case "contains":
      return cell.includes(operand)
    case "notContains":
      return !cell.includes(operand)
    case "is":
      return cell === operand
    case "isNot":
      return cell !== operand
    default:
      return false
  }
}

function matchesNumber(display: string, filter: ColumnFilterValue): boolean {
  const cell = parseNumber(display)
  if (cell === null) return false
  // The operand goes through the same parser as the cell, so 1,000 and $1,000
  // typed into the box mean what they look like.
  const operand = parseNumber(filter.value)
  if (operand === null) return false

  return compare(cell, operand, filter, () => parseNumber(filter.value2 ?? ""))
}

function matchesDate(display: string, filter: ColumnFilterValue): boolean {
  const cell = parseDate(display)
  if (cell === null) return false
  const operand = parseDate(filter.value)
  if (operand === null) return false

  return compare(cell, operand, filter, () => parseDate(filter.value2 ?? ""))
}

/** The one comparison table, shared so a number and a date cannot disagree. */
function compare(
  cell: number,
  operand: number,
  filter: ColumnFilterValue,
  upper: () => number | null,
): boolean {
  switch (filter.op) {
    case "gt":
    case "after":
      return cell > operand
    case "lt":
    case "before":
      return cell < operand
    case "gte":
      return cell >= operand
    case "lte":
      return cell <= operand
    case "eq":
    case "on":
      return cell === operand
    case "between": {
      const other = upper()
      if (other === null) return false
      // Endpoints given the wrong way round are swapped rather than rejected.
      return cell >= Math.min(operand, other) && cell <= Math.max(operand, other)
    }
    default:
      return false
  }
}

function matchesBoolean(display: string, filter: ColumnFilterValue): boolean {
  const cell = parseBoolean(display)
  if (cell === null) return false
  return filter.op === "isYes" ? cell : filter.op === "isNo" ? !cell : false
}

function matchesList(display: string, filter: ColumnFilterValue): boolean {
  const operand = filter.value.trim().toLowerCase()
  const has = parseList(display).some((item) => item.toLowerCase() === operand)
  return filter.op === "hasItem" ? has : filter.op === "lacksItem" ? !has : false
}

/**
 * How many cells in this column hold text the column's own type cannot read.
 *
 * The blanks are not counted: "no value" is a different fact from "a value I
 * cannot read", and the popover's note is about the second one.
 */
export function unreadable(type: FieldType, rows: TableRow[], key: string): number {
  const parse =
    type === "number" || type === "currency" ? parseNumber : type === "date" ? parseDate : null
  if (!parse) return 0

  return rows.filter((row) => {
    const value = row.values[key]
    return !isBlank(value) && parse(value!.display) === null
  }).length
}

/** The operand half of a chip. The operator half is `OPERATOR_LABELS`. */
export function describeOperand(filter: ColumnFilterValue): string {
  if (ARITY[filter.op] === 0) return ""
  if (ARITY[filter.op] === 2) return `${filter.value} and ${filter.value2 ?? ""}`
  return filter.value
}
