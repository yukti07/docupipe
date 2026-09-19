import type { FieldType, TableRow } from "@/lib/api/types"
import { CELL_FONT_PX, type DensityOption } from "@/lib/density"

/**
 * How wide each column of a data table should be.
 *
 * A data table cannot let the browser size its own columns. The body is
 * windowed past a hundred rows, so `table-layout: auto` measures whatever
 * happens to be mounted and every scroll re-sizes the whole grid under the
 * reader. Fixed widths measured once are the only version of this that holds
 * still — and measuring them beats guessing, because a column of two-letter
 * codes and a column of addresses are both `text`.
 */

/** Rows read to size a column. Past this the widest cell is almost certainly seen. */
const SAMPLE = 150

/** What a column may never shrink below or grow past, by what it holds. */
const CLAMP: Record<FieldType, { min: number; max: number }> = {
  number: { min: 92, max: 160 },
  currency: { min: 92, max: 160 },
  date: { min: 104, max: 150 },
  boolean: { min: 88, max: 120 },
  list: { min: 120, max: 280 },
  text: { min: 110, max: 320 },
}

/** The cell's own left and right padding, which compact tightens. */
const CELL_CHROME: Record<DensityOption, number> = { comfortable: 26, compact: 22 }
/**
 * Everything on the header row that is not the column's name: the cell
 * padding, the drag handle, the sort chevron, the filter button, and the gaps
 * between them. Measured off the rendered header rather than guessed — a
 * header that does not fit truncates the one string always on the column.
 */
const HEADER_CHROME: Record<DensityOption, number> = { comfortable: 100, compact: 94 }
/** The badge's border, padding, and the letter-spacing canvas will not see. */
const BADGE_CHROME = 18
/** A header may always fit, up to here. Past it the name is the anomaly. */
const HEADER_MAX = 300
/**
 * How far compact may pull a column's floor in. The floor keeps a column
 * legible; compact is a deliberate trade of room for rows on screen, so it
 * gets to make that trade on the width as well as on the height.
 */
const COMPACT_FLOOR = 0.85

export type ColumnSpec = {
  id: string
  header: string
  type: FieldType
  /** The type badge's text, where the header draws one. */
  badge?: string
  /** Read off the row rather than out of `values` — the merged source column. */
  read?: (row: TableRow) => string
}

export type MeasureOptions = {
  /** Compact draws smaller text in tighter padding, and drops the type badge. */
  density?: DensityOption
}

/**
 * The width of every column, in pixels, keyed by column id.
 *
 * Called once per table rather than per render: it walks a sample of the rows,
 * and the answer only changes when the rows or the fields do.
 */
export function measureColumns(
  columns: ColumnSpec[],
  rows: TableRow[],
  { density = "comfortable" }: MeasureOptions = {},
): Map<string, number> {
  const measure = textMeasurer(CELL_FONT_PX[density])
  const sample = rows.slice(0, SAMPLE)
  const widths = new Map<string, number>()
  const compact = density === "compact"
  const typeBadge = !compact

  for (const column of columns) {
    const clamps = CLAMP[column.type]
    const min = compact ? clamps.min * COMPACT_FLOOR : clamps.min
    const max = clamps.max
    // Measured as it is drawn — uppercase, which is wider per character than
    // the label's own casing, and the difference is what was truncating the
    // short names on a currency column.
    const badge =
      typeBadge && column.badge
        ? measure(column.badge.toUpperCase(), "badge") + BADGE_CHROME
        : 0
    const header = measure(column.header, "mono") + HEADER_CHROME[density] + badge

    let widest = 0
    for (const row of sample) {
      const text = column.read ? column.read(row) : (row.values[column.id]?.display ?? "")
      if (text === "") continue
      const cell = measure(text, "sans")
      if (cell > widest) widest = cell
    }

    // The ceiling is on what the *cells* need. A column is never narrower
    // than its own name, because a header nobody can read names nothing —
    // and it is the one string on the column that is always on screen.
    const content = clamp(widest + CELL_CHROME[density], min, max)
    widths.set(column.id, Math.round(Math.max(content, Math.min(header, HEADER_MAX))))
  }

  return widths
}

const clamp = (value: number, min: number, max: number) =>
  Math.round(Math.min(max, Math.max(min, value)))

type Face = "mono" | "sans" | "badge"

/** The faces the table draws in, at the sizes it draws them. */
const font = (cellPx: number): Record<Face, string> => ({
  mono: "11.5px ui-monospace, monospace",
  sans: `${cellPx}px ui-sans-serif, system-ui, sans-serif`,
  // Drawn at 9.5px, measured at 10: the badge is letter-spaced and canvas
  // does not apply tracking, so the extra size stands in for it.
  badge: "10px ui-sans-serif, system-ui, sans-serif",
})

/** Average advance width per character, for when nothing can be measured. */
const estimate = (cellPx: number): Record<Face, number> => ({
  mono: 7,
  sans: cellPx * 0.53,
  badge: 7.4,
})

/**
 * Measures a string in the face it will be drawn in.
 *
 * Canvas is the only way to ask that question without putting the text on the
 * page and reading it back, which would cost a layout per column. Where there
 * is no canvas — a server render, and jsdom under test — it falls back to an
 * average advance width. That is wrong by a few pixels on a proportional face
 * and exactly right on the monospaced one, and the clamps above absorb the
 * difference either way.
 */
function textMeasurer(cellPx: number): (text: string, face: Face) => number {
  const fonts = font(cellPx)
  const context = canvasContext()
  if (!context) {
    const estimates = estimate(cellPx)
    return (text, face) => text.length * estimates[face]
  }

  return (text, face) => {
    context.font = fonts[face]
    return context.measureText(text).width
  }
}

function canvasContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null
  try {
    return document.createElement("canvas").getContext("2d")
  } catch {
    return null
  }
}
