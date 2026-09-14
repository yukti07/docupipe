"use client"

import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatCount } from "@/lib/format"

/**
 * Moving through the marked cells moves the selection *and* the evidence panel
 * together — stepping to a cell whose source panel still shows the last one
 * would be worse than no navigation at all.
 */
export function MarkedCellNav({
  valueIds,
  currentValueId,
  onSelect,
}: {
  valueIds: string[]
  currentValueId: string | null
  onSelect: (valueId: string) => void
}) {
  if (valueIds.length === 0) return null

  const index = currentValueId ? valueIds.indexOf(currentValueId) : -1
  const position = index >= 0 ? index : 0

  const step = (delta: number) => {
    const next = (position + delta + valueIds.length) % valueIds.length
    onSelect(valueIds[next])
  }

  return (
    <div className="flex items-center gap-1 rounded-lg border border-review-border bg-review-bg px-1.5 py-0.5">
      <AlertTriangle aria-hidden className="size-3.5 text-review-icon" strokeWidth={2} />
      <span className="px-1 text-[12px] tabular-nums text-review">
        {index >= 0 ? `${formatCount(index + 1)} of ${formatCount(valueIds.length)}` : `${formatCount(valueIds.length)} to check`}
      </span>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Previous cell to check"
        onClick={() => step(-1)}
        className="size-7 rounded-md"
      >
        <ChevronLeft aria-hidden className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Next cell to check"
        onClick={() => step(1)}
        className="size-7 rounded-md"
      >
        <ChevronRight aria-hidden className="size-3.5" />
      </Button>
    </div>
  )
}
