import type { SchemaField, TableData, TableRow } from "@/lib/api/types"
import { fieldHeader } from "@/lib/schema"

/**
 * One workbook, one worksheet per table.
 *
 * The cell rules are the CSV's rules, because a batch downloaded two ways must
 * not say two different things: a value that was **not found exports as an
 * empty cell, never as a zero** — a zero is a claim the document never made.
 *
 * `exceljs` is imported inside `toWorkbook` rather than at the top of the file.
 * It is close to a megabyte, and nobody who does not press Spreadsheet should
 * pay for it.
 */

export type SheetSource = Pick<TableData, "fields" | "rows"> & {
  /** What the sheet tab will say, before truncation and de-duplication. */
  name: string
  /** A merged table's first column, naming which table each row came from. */
  sourceColumn?: { header: string; value: (row: TableRow) => string }
}

/** Excel's own limits on a sheet name, which it enforces by refusing the file. */
const MAX_SHEET_NAME = 31
const ILLEGAL_IN_SHEET_NAME = /[[\]:*?/\\]/g

/**
 * A legal, unique sheet name.
 *
 * Truncation happens before the suffix, not after, so two files whose names
 * agree for the first 31 characters still land on different tabs — which is
 * exactly the case a batch of `invoice-2026-03-<n>.pdf` produces.
 */
export function sheetName(raw: string, taken: Set<string>): string {
  const base =
    raw
      .replace(/\.[^.]+$/, "")
      .replace(ILLEGAL_IN_SHEET_NAME, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_SHEET_NAME) || "Sheet"

  if (!taken.has(base)) {
    taken.add(base)
    return base
  }

  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`
    const candidate = `${base.slice(0, MAX_SHEET_NAME - suffix.length)}${suffix}`
    if (!taken.has(candidate)) {
      taken.add(candidate)
      return candidate
    }
  }
}

/**
 * Text, unless the field is a number and its display actually parses as one.
 *
 * Writing everything as text would give a spreadsheet nothing can sum; writing
 * everything as a number would turn an invoice reference into 1.044e3. Only a
 * field the schema calls numeric, whose text is plainly a number, is written as
 * one.
 */
export function cellValue(display: string, type: SchemaField["type"]): string | number {
  if (type !== "number" && type !== "currency") return display
  // Thousands separators and a leading currency symbol are display, not data.
  const cleaned = display.replace(/[,\s]/g, "").replace(/^[^\d+-.]+/, "")
  if (cleaned === "" || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return display
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : display
}

/** The rows of one sheet, header included, with not-found left empty. */
export function sheetRows(sheet: SheetSource): (string | number | null)[][] {
  const header: string[] = sheet.sourceColumn ? [sheet.sourceColumn.header] : []
  // The same header the CSV and the screen use: the amounts are written as
  // bare numbers so the sheet can sum them, which leaves the column name as
  // the only place the currency can be said.
  header.push(...sheet.fields.map((field) => fieldHeader(field)))

  const body = sheet.rows.map((row) => {
    const cells: (string | number | null)[] = sheet.sourceColumn
      ? [sheet.sourceColumn.value(row)]
      : []
    for (const field of sheet.fields) {
      const value = row.values[field.key]
      // A cell the document did not yield is empty. Never a zero, and never
      // the string "not found" either — both would be read as data.
      if (!value || value.state === "not-found") {
        cells.push(null)
        continue
      }
      cells.push(cellValue(value.display, field.type))
    }
    return cells
  })

  return [header, ...body]
}

export async function toWorkbook(sheets: SheetSource[]): Promise<Blob> {
  const { Workbook } = await import("exceljs")
  const workbook = new Workbook()
  workbook.created = new Date()

  const taken = new Set<string>()
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheetName(sheet.name, taken))
    const rows = sheetRows(sheet)
    worksheet.addRows(rows)

    const header = worksheet.getRow(1)
    header.font = { bold: true }
    // The header stays put on a sheet of ten thousand rows, which is the whole
    // reason to ship a workbook rather than a folder of CSVs.
    worksheet.views = [{ state: "frozen", ySplit: 1 }]

    worksheet.columns.forEach((column, index) => {
      const widest = rows.reduce(
        (max, row) => Math.max(max, String(row[index] ?? "").length),
        0,
      )
      column.width = Math.min(48, Math.max(10, widest + 2))
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
}

export function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoked on the next tick so the click has taken the url first.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
