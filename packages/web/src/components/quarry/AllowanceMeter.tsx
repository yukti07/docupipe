"use client"

import { RaiseCapDialog } from "@/components/quarry/RaiseCapDialog"
import { formatClock, formatCount } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The page allowance, on every screen. It is the one number that explains a
 * pause before it happens, so it is never hidden behind a menu.
 */
export function AllowanceMeter({
  used,
  limit,
  resetsAt,
  raiseCap,
  className,
}: {
  used: number
  limit: number
  resetsAt?: string
  /** Offered only where it means something — beside a batch that has stopped. */
  raiseCap?: boolean
  className?: string
}) {
  const fraction = limit > 0 ? Math.min(1, used / limit) : 0
  const spent = fraction >= 1

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="hidden text-[11.5px] text-muted-foreground sm:inline">Pages today</span>
      <span
        className="font-mono text-[12px] tabular-nums text-subtle-foreground"
        title={resetsAt ? `Resets at ${formatClock(resetsAt)}` : undefined}
      >
        {formatCount(used)} / {formatCount(limit)}
      </span>
      <span
        role="progressbar"
        aria-label="Page allowance used today"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        className="h-[5px] w-20 overflow-hidden rounded-full bg-border-subtle"
      >
        <span
          className={cn("block h-full rounded-full", spent ? "bg-paused" : "bg-primary")}
          style={{ width: `${fraction * 100}%` }}
        />
      </span>
      {raiseCap && <RaiseCapDialog resetsAt={resetsAt} />}
    </div>
  )
}
