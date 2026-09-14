import { AlertTriangle, CircleX, Pause } from "lucide-react"
import type { Failure } from "@/lib/api/types"
import { failureCopy, type FailureTone } from "@/lib/failures"
import { cn } from "@/lib/utils"

const TONE: Record<FailureTone, { box: string; icon: typeof CircleX }> = {
  error: { box: "bg-error-bg border-error-border text-error-strong", icon: CircleX },
  review: { box: "bg-review-bg border-review-border text-review", icon: AlertTriangle },
  paused: { box: "bg-paused-bg border-paused-border text-paused-strong", icon: Pause },
}

export function FailureMessage({
  failure,
  compact = false,
  className,
}: {
  failure: Failure
  compact?: boolean
  className?: string
}) {
  const copy = failureCopy(failure)
  const tone = TONE[copy.tone]
  const Icon = tone.icon

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3 text-[13px] leading-[1.5]",
        tone.box,
        className,
      )}
    >
      <Icon aria-hidden className="mt-px size-4 shrink-0" strokeWidth={1.9} />
      <div className="min-w-0">
        <p className="font-medium">{copy.message}</p>
        {!compact && <p className="mt-0.5 opacity-80">{copy.nextStep}</p>}
      </div>
    </div>
  )
}
