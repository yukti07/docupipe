import { Pause } from "lucide-react"
import { AllowanceMeter } from "@/components/quarry/AllowanceMeter"
import type { ResultPollResponse } from "@/lib/api/types"
import { formatClock } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Running out of the daily allowance is routine, nobody's fault, and loses
 * nothing. It renders in --paused: never amber, which would read as a warning,
 * and never red, which would read as a failure.
 */
export function PausedBanner({
  pausedUntil,
  allowance,
  reason = "quota",
  className,
}: {
  pausedUntil: string | null
  allowance?: ResultPollResponse["allowance"]
  reason?: "quota" | "user-cap"
  className?: string
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-paused-border bg-paused-bg px-4 py-3",
        className,
      )}
    >
      <Pause aria-hidden className="size-4 shrink-0 text-paused" strokeWidth={1.9} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-paused-strong">
          {reason === "quota" ? "Daily page allowance used up." : "You've hit your processing cap."}
          {pausedUntil ? ` Picking up again at ${formatClock(pausedUntil)}.` : ""}
        </p>
        <p className="mt-0.5 text-[12.5px] text-paused-strong/80">
          Nothing is lost. Every table that has already finished stays open and downloadable.
        </p>
      </div>
      {allowance && (
        <AllowanceMeter
          used={allowance.used}
          limit={allowance.limit}
          resetsAt={allowance.resetsAt}
          raiseCap
        />
      )}
    </div>
  )
}
