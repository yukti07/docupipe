import Link from "next/link"
import { StatusBadge } from "@/components/common/StatusBadge"
import { formatClock, formatCount, formatEta } from "@/lib/format"
import type { WorkspaceBatch } from "@/state/workspace"
import { cn } from "@/lib/utils"

/** Six states, and the card says which one it is in words as well as in colour. */
export function BatchCard({ batch, className }: { batch: WorkspaceBatch; className?: string }) {
  const { summary } = batch
  const failed = summary.failed ?? 0

  return (
    <Link
      href={`/request/${batch.requestId}`}
      className={cn(
        "flex items-center gap-4 rounded-xl border border-border-subtle bg-card px-5 py-4 transition-colors hover:border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium">{batch.name}</p>
        <p className="mt-0.5 text-[12.5px] tabular-nums text-muted-foreground">
          {formatCount(batch.fileCount)} {batch.fileCount === 1 ? "file" : "files"} ·{" "}
          {new Date(batch.createdAt).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
          })}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Badges batch={batch} failed={failed} />
        <p className="text-[12px] tabular-nums text-subtle-foreground">
          <Detail batch={batch} />
        </p>
      </div>
    </Link>
  )
}

function Badges({ batch, failed }: { batch: WorkspaceBatch; failed: number }) {
  return (
    <span className="flex items-center gap-1.5">
      {batch.phase === "prepare" && <StatusBadge variant="neutral">Awaiting your schemas</StatusBadge>}
      {batch.phase === "converting" && <StatusBadge variant="working">Converting</StatusBadge>}
      {batch.phase === "paused" && <StatusBadge variant="paused">Paused</StatusBadge>}
      {/* C3 — the accent marks completion; a finished chip is neutral. */}
      {batch.phase === "done" && <StatusBadge variant="neutral">Done</StatusBadge>}
      {batch.phase === "failed" && <StatusBadge variant="error">Nothing usable</StatusBadge>}
      {batch.phase !== "failed" && failed > 0 && (
        <StatusBadge variant="error">
          {formatCount(failed)} failed
        </StatusBadge>
      )}
      {(batch.summary.toCheck ?? 0) > 0 && (
        <StatusBadge variant="review">{formatCount(batch.summary.toCheck ?? 0)} to check</StatusBadge>
      )}
    </span>
  )
}

function Detail({ batch }: { batch: WorkspaceBatch }) {
  const { summary } = batch

  if (batch.phase === "prepare") {
    return <>{formatCount(batch.fileCount)} waiting on you</>
  }

  if (batch.phase === "paused") {
    return summary.pausedUntil ? (
      <>picking up again at {formatClock(summary.pausedUntil)}</>
    ) : (
      <>waiting on a limit</>
    )
  }

  if (batch.phase === "converting") {
    const eta = formatEta(summary.etaSeconds ?? null)
    return (
      <>
        {formatCount(summary.tables ?? 0)} of {formatCount(batch.fileCount)} done
        {eta ? ` · ${eta}` : ""}
      </>
    )
  }

  if (batch.phase === "failed") return <>none of these could be read</>

  return (
    <>
      {formatCount(summary.rows ?? 0)} rows across {formatCount(summary.tables ?? 0)} tables
    </>
  )
}
