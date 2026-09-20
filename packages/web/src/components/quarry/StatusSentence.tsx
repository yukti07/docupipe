import type { ResultPollResponse } from "@/lib/api/types"
import { formatClock, formatCount } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The one honest line in the header. It has to read true in every state,
 * including the two nobody wants to write: a pause, and a batch where nothing
 * could be read at all.
 */
export function statusSentence(result: ResultPollResponse, awaiting = 0): string {
  const { counts } = result
  // Files with no table yet count into both figures. They are in the batch —
  // the rows for them are on screen — so leaving them out would print "2 of 2
  // done" above eight rows, six of which are still being read.
  const total =
    counts.queued + counts.extracting + counts.filling + counts.done + counts.failed + awaiting
  const toCheck = result.files.reduce((sum, file) => sum + (file.toCheckCount ?? 0), 0)
  const waiting = counts.queued + counts.extracting + counts.filling + awaiting

  const done = `${formatCount(counts.done)} of ${formatCount(total)} done`

  if (result.status === "PAUSED") {
    return result.pausedUntil
      ? `${done} · picking up again at ${formatClock(result.pausedUntil)}`
      : `${done} · paused, waiting on a limit`
  }

  if (counts.done === 0 && counts.failed === total && total > 0) {
    return `${done} · none of these could be read`
  }

  const parts = [done]
  if (result.status === "CONVERTING" && waiting > 0) {
    parts.push(`${formatCount(waiting)} waiting`)
  }
  if (toCheck > 0) parts.push(`${formatCount(toCheck)} to check`)
  if (counts.failed > 0) parts.push(`${formatCount(counts.failed)} failed`)
  return parts.join(" · ")
}

export function StatusSentence({
  result,
  awaiting = 0,
  className,
}: {
  result: ResultPollResponse
  /** Files in this batch the server has not answered for yet. */
  awaiting?: number
  className?: string
}) {
  return (
    <p
      aria-live="polite"
      className={cn("text-[13px] tabular-nums text-subtle-foreground", className)}
    >
      {statusSentence(result, awaiting)}
    </p>
  )
}
