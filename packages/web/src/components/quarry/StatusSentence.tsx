import type { ResultPollResponse } from "@/lib/api/types"
import { formatClock, formatCount } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The one honest line in the header. It has to read true in every state,
 * including the two nobody wants to write: a pause, and a batch where nothing
 * could be read at all.
 */
export function statusSentence(result: ResultPollResponse): string {
  const { counts } = result
  const total = counts.queued + counts.extracting + counts.filling + counts.done + counts.failed
  const toCheck = result.files.reduce((sum, file) => sum + (file.toCheckCount ?? 0), 0)
  const waiting = counts.queued + counts.extracting + counts.filling

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
  className,
}: {
  result: ResultPollResponse
  className?: string
}) {
  return (
    <p
      aria-live="polite"
      className={cn("text-[13px] tabular-nums text-subtle-foreground", className)}
    >
      {statusSentence(result)}
    </p>
  )
}
