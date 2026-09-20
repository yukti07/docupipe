import Link from "next/link"
import { StatusBadge } from "@/components/common/StatusBadge"
import { formatCount, formatStamp } from "@/lib/format"
import type { WorkspaceBatch } from "@/state/workspace"
import { cn } from "@/lib/utils"

/**
 * One batch in the history: when it was dropped, what came out of it, and
 * where it got to.
 *
 * It is headed by the time rather than by a name because the name was never
 * one. A drop of loose files was called "Batch of 20 Sep", which is the date
 * written twice and badly; a dropped folder took the folder's name, so two
 * drops of the same folder were two identical cards. The stamp is the one
 * thing that is always true and always different.
 */
export function BatchCard({ batch, className }: { batch: WorkspaceBatch; className?: string }) {
  const { summary, phase } = batch
  const failed = summary.failed ?? 0
  const toCheck = summary.toCheck ?? 0
  // "Nothing usable" already says every one of them failed; the count beneath
  // it would be the same fact with a number on it.
  const notes = phase !== "failed" && failed > 0

  return (
    <Link
      href={`/request/${batch.requestId}`}
      className={cn(
        "flex items-center gap-4 rounded-xl border border-border-subtle bg-card px-5 py-4 transition-colors hover:border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium tabular-nums">
          {formatStamp(batch.createdAt)}
        </p>
        <p className="mt-0.5 truncate text-[12.5px] tabular-nums text-muted-foreground">
          {contents(batch)}
        </p>
      </div>

      {/* The status, and nothing beside it. The counts that used to sit under
          these chips were the same numbers as the line on the left, arranged
          differently — two readings of one batch, on one card.

          Two rows rather than one: where a batch got to is the thing you scan
          a list of these for, so its chip holds the same right edge on every
          card. Set beside it, a "1 failed" pushed Done left and broke the
          column exactly on the cards worth finding. What went wrong is worth
          saying — under it, where it reads as a note on that status rather
          than as a second one. */}
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        {phase === "prepare" && <StatusBadge variant="neutral">Awaiting your schemas</StatusBadge>}
        {phase === "converting" && <StatusBadge variant="working">Converting</StatusBadge>}
        {phase === "paused" && <StatusBadge variant="paused">Paused</StatusBadge>}
        {/* C3 — the accent marks completion; a finished chip is neutral. */}
        {phase === "done" && <StatusBadge variant="neutral">Done</StatusBadge>}
        {phase === "failed" && <StatusBadge variant="error">Nothing usable</StatusBadge>}

        {(notes || toCheck > 0) && (
          <span className="flex items-center gap-1.5">
            {notes && <StatusBadge variant="error">{formatCount(failed)} failed</StatusBadge>}
            {toCheck > 0 && (
              <StatusBadge variant="review">{formatCount(toCheck)} to check</StatusBadge>
            )}
          </span>
        )}
      </span>
    </Link>
  )
}

/**
 * What the batch holds — files, then the tables and rows they became.
 *
 * Each part appears only once there is one: a batch that has not converted has
 * no tables to count, and a zero there would read as a batch that produced
 * nothing rather than one that has not been asked to yet.
 */
function contents(batch: WorkspaceBatch): string {
  const { tables = 0, rows = 0 } = batch.summary
  const parts = [`${formatCount(batch.fileCount)} ${batch.fileCount === 1 ? "file" : "files"}`]
  if (tables > 0) parts.push(`${formatCount(tables)} ${tables === 1 ? "table" : "tables"}`)
  if (rows > 0) parts.push(`${formatCount(rows)} ${rows === 1 ? "row" : "rows"}`)
  return parts.join(" · ")
}
