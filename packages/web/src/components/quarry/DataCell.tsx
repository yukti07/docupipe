"use client"

import { MarkedCellReason } from "@/components/quarry/MarkedCellReason"
import type { CellValue } from "@/lib/api/types"
import { cn } from "@/lib/utils"

/**
 * Four states, each distinct without relying on colour: a value, a value that
 * genuinely was not in the document, a value an automatic check marked, and a
 * cell on a row the document could not yield at all.
 *
 * A blank and a zero are different claims, and neither is ever substituted for
 * "not found".
 */
export function DataCell({
  value,
  failedRow,
  selected,
  onOpenEvidence,
  className,
}: {
  value: CellValue | undefined
  /** The whole row failed; this cell is greyed and labelled with it. */
  failedRow?: boolean
  selected?: boolean
  /** Evidence opens from any cell, not only the marked ones. */
  onOpenEvidence?: (valueId: string) => void
  className?: string
}) {
  const state = failedRow ? "failed-row" : (value?.state ?? "not-found")

  const body =
    state === "not-found" || state === "failed-row" ? (
      <span className="italic text-muted-foreground">not found</span>
    ) : (
      <span className="tabular-nums">{value?.display}</span>
    )

  const content = (
    <span className="flex min-w-0 flex-col items-start gap-0.5">
      <span className="w-full truncate text-left">{body}</span>
      {state === "marked" && value?.reason && <MarkedCellReason reason={value.reason} />}
    </span>
  )

  const classes = cn(
    "block w-full px-3 py-2 text-left text-[13px] leading-[1.4]",
    state === "marked" && "bg-review-cell",
    state === "failed-row" && "text-muted-foreground",
    selected && "outline outline-2 -outline-offset-2 outline-primary",
    className,
  )

  if (!value || !onOpenEvidence) {
    return (
      <div data-cell={state} className={classes}>
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      data-cell={state}
      onClick={() => onOpenEvidence(value.valueId)}
      aria-label={evidenceLabel(value, state)}
      className={cn(
        classes,
        "cursor-pointer hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
        state === "marked" && "hover:bg-review-cell/80",
      )}
    >
      {content}
    </button>
  )
}

function evidenceLabel(value: CellValue, state: string): string {
  const shown = state === "not-found" || state === "failed-row" ? "not found" : value.display
  return `${shown} — show where this came from`
}
