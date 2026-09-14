import { AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Why this cell is amber, in the table itself rather than behind a hover. The
 * server decides the reason; the UI never re-derives it.
 */
export function MarkedCellReason({ reason, className }: { reason: string; className?: string }) {
  return (
    <span className={cn("flex items-start gap-1 text-[11px] leading-[1.35] text-review", className)}>
      <AlertTriangle aria-hidden className="mt-px size-3 shrink-0 text-review-icon" strokeWidth={2} />
      <span>{reason}</span>
    </span>
  )
}
