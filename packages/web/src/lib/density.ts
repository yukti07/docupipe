/**
 * How tightly a data table packs its rows.
 *
 * The padding lives here rather than on the table because the cell is what
 * actually sets a row's height, and the cell cannot import it from the table
 * without the two importing each other. The row heights are what the virtualizer
 * estimates with, so they are kept in step with the padding below — an estimate
 * that disagrees with the rendered row makes the scrollbar lie.
 */
export type DensityOption = "comfortable" | "compact"

export const CELL_PADDING: Record<DensityOption, string> = {
  comfortable: "px-3 py-2",
  compact: "px-2.5 py-1",
}

export const HEADER_PADDING: Record<DensityOption, string> = {
  comfortable: "px-3 py-2.5",
  compact: "px-2.5 py-1.5",
}

/**
 * Compact sets its text smaller as well as tighter. Padding alone moved the
 * rows closer together and left every column exactly as wide as before, which
 * is not what a density control is for.
 */
export const CELL_TEXT: Record<DensityOption, string> = {
  comfortable: "text-[13px]",
  compact: "text-[12px]",
}

/** The same sizes as a number, for the column sizer, which measures rather than styles. */
export const CELL_FONT_PX: Record<DensityOption, number> = { comfortable: 13, compact: 12 }

/** The text at 1.4 line-height, plus the padding above and a 1px rule. */
export const ROW_HEIGHT: Record<DensityOption, number> = { comfortable: 36, compact: 26 }
