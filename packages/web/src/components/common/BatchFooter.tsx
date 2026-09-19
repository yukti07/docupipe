import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * The bar along the bottom of every screen inside a batch.
 *
 * What a screen can do next is always here, in the same place, at the same
 * height — a button that moves between screens is a button people stop looking
 * for. The side panel floats over its right end rather than displacing it, so
 * opening a panel never shifts the controls underneath.
 */
export function BatchFooter({
  status,
  actions,
  banner,
  progress,
  progressLabel = "Progress",
  className,
}: {
  /** What this screen is, on the left — counts, a sentence, a spinner. */
  status?: ReactNode
  /** What this screen can do, on the right. */
  actions?: ReactNode
  /** A failure that belongs to the action beside it, above the row. */
  banner?: ReactNode
  /** 0–1 along the top edge. Omitted where there is nothing running. */
  progress?: number
  progressLabel?: string
  className?: string
}) {
  return (
    <footer
      className={cn(
        "relative z-30 shrink-0 border-t border-border-subtle bg-card",
        className,
      )}
    >
      {progress !== undefined && (
        <div
          role="progressbar"
          aria-label={progressLabel}
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-[3px] w-full bg-border-subtle"
        >
          <div
            className="h-full bg-primary transition-[width] duration-300"
            style={{ width: `${Math.min(100, Math.max(0, progress) * 100)}%` }}
          />
        </div>
      )}

      <div className="flex flex-col gap-3 px-6 py-3">
        {banner}
        <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">{status}</div>
          <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      </div>
    </footer>
  )
}
