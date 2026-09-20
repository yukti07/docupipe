import type { SchemaField, TableData, TableRow } from "@/lib/api/types"
import { fieldHeader } from "@/lib/schema"

export type Delimiter = "," | "\t"

/** Excel reads a leading =, +, - or @ as a formula, so a cell is prefixed out of it. */
function escapeCell(value: string, delimiter: Delimiter): string {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value
  const needsQuotes =
    guarded.includes(delimiter) ||
    guarded.includes('"') ||
    guarded.includes("\n") ||
    guarded.includes("\r")
  return needsQuotes ? `"${guarded.replaceAll('"', '""')}"` : guarded
}

/** The column a merged table gains, named the same in every export and on screen. */
export const SOURCE_COLUMN = "source_file"

/**
 * The source column, for a merged table, and nothing for any other. One
 * definition so the screen, the CSV and the workbook cannot disagree about
 * whether a table has it or what it is called.
 */
export function sourceColumnFor(
  table: Pick<TableData, "merged">,
): { header: string; value: (row: TableRow) => string } | undefined {
  if (!table.merged) return undefined
  return { header: SOURCE_COLUMN, value: (row) => row.sourceFile ?? "" }
}

export type CsvSummary = {
  rows: number
  /** Rows the document could not yield at all. Exported, but marked. */
  failedRows: number
  /** Cells that genuinely were not in the document. Empty in the file, counted here. */
  notFound: number
  /** Cells an automatic check marked. */
  marked: number
}

/**
 * "not found" exports as an empty cell — never as 0, which would be a claim the
 * document never made — and the summary says how many there were, so the number
 * is not lost by being invisible.
 */
export function toCsv(
  table: Pick<TableData, "fields" | "rows">,
  options: { delimiter?: Delimiter; sourceColumn?: (row: TableRow) => string } = {},
): { text: string; summary: CsvSummary } {
  const delimiter = options.delimiter ?? ","
  const summary: CsvSummary = { rows: 0, failedRows: 0, notFound: 0, marked: 0 }

  const header: string[] = options.sourceColumn ? ["source_file"] : []
  // Named as the screen names them, so a currency column carries its code out
  // of here: the numbers in the file are bare, and "1299.50" in a column
  // called `total` does not say what it is 1299.50 of.
  header.push(...table.fields.map((field: SchemaField) => fieldHeader(field)))
  const lines = [header.map((cell) => escapeCell(cell, delimiter)).join(delimiter)]

  for (const row of table.rows) {
    summary.rows += 1
    if (row.failed) summary.failedRows += 1

    const cells: string[] = options.sourceColumn ? [options.sourceColumn(row)] : []
    for (const field of table.fields) {
      const value = row.values[field.key]
      if (!value || value.state === "not-found") {
        if (value?.state === "not-found") summary.notFound += 1
        cells.push("")
        continue
      }
      if (value.state === "marked") summary.marked += 1
      cells.push(value.display)
    }
    lines.push(cells.map((cell) => escapeCell(cell, delimiter)).join(delimiter))
  }

  return { text: lines.join("\r\n"), summary }
}

export function downloadText(fileName: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mime })
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

export const csvFileName = (name: string, extension = "csv") =>
  `${name.replace(/\.[^.]+$/, "")}.${extension}`
