import { AlignLeft, Check, Table2 } from "lucide-react"
import type { ResultPollResponse } from "@/lib/api/types"
import { formatCount } from "@/lib/format"
import { cn } from "@/lib/utils"

type Counts = ResultPollResponse["counts"]

export type PipelineStage = "detect" | "process" | "done"

/**
 * What the batch is doing, as the three things it actually does: read a shape
 * out of each file, fill a table from it, and finish.
 *
 * It is three rather than the server's five because the five are stages of the
 * worker, not of the wait. Queued, extracting and filling are one thing from
 * the outside — the table is being made — and splitting them across three
 * cards asked a reader to learn a pipeline in order to find out whether
 * anything was wrong.
 *
 * The counts still add up to everything in the batch, failures and files yet
 * to give up a shape included, so a stage that has lost a table shows as a sum
 * that no longer reaches the total.
 */
export function PipelineStrip({
  counts,
  detecting = 0,
  className,
}: {
  counts: Counts
  /**
   * Files the server has not answered for yet. Convert is not gated on shapes,
   * so a batch can be converting with half its files still being read — and
   * those files are in the batch whether or not there is a table for them.
   */
  detecting?: number
  className?: string
}) {
  const processing = counts.queued + counts.extracting + counts.filling
  const finished = counts.done + counts.failed
  const total = detecting + processing + finished
  const current = currentStage({ detecting, processing, finished })

  // Only one card ever carries a second line, and it carries it only when
  // something went wrong. The other two said "nothing waiting" and "nothing
  // running" beside a nought, which is the nought again in words — three lines
  // of small print for a strip whose whole job is three numbers.
  const stages = [
    { key: "detect", label: "Schema Detection", icon: AlignLeft, value: detecting },
    { key: "process", label: "Data Processing", icon: Table2, value: processing },
    {
      key: "done",
      label: "Done",
      icon: Check,
      value: finished,
      note:
        counts.failed > 0 ? `${formatCount(counts.failed)} of them failed` : undefined,
    },
  ] as const

  return (
    <div className={cn("grid items-stretch gap-3 sm:grid-cols-3", className)}>
      {stages.map((stage) => {
        const here = stage.key === current
        const Icon = stage.icon
        return (
          <div
            key={stage.key}
            data-stage={stage.key}
            data-active={here || undefined}
            className={cn(
              "flex items-center gap-3 rounded-xl border transition-all",
              // The stage being worked on is the one worth finding from across
              // the room, so it is the bigger card as well as the tinted one.
              here
                ? "border-primary-tint-border bg-primary-tint px-4 py-3.5"
                : "border-border-faint bg-card px-3.5 py-3",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "grid shrink-0 place-items-center rounded-lg",
                here
                  ? "size-9 bg-primary-tint-strong text-primary"
                  : "size-8 bg-muted text-muted-foreground",
              )}
            >
              <Icon className={here ? "size-[18px]" : "size-4"} strokeWidth={2} />
            </span>

            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "truncate font-medium leading-tight",
                  here ? "text-[14px] text-foreground" : "text-[13px] text-foreground",
                )}
              >
                {stage.label}
              </p>
              {/* A failure is the one thing here worth a second glance, so it
                  is the one thing wearing the error tone. */}
              {"note" in stage && stage.note && (
                <p className="mt-0.5 truncate font-mono text-[11.5px] text-error-strong">
                  {stage.note}
                </p>
              )}
            </div>

            <p
              data-count
              className={cn(
                "shrink-0 font-mono tabular-nums leading-none",
                here ? "text-[22px] font-medium text-primary" : "text-[19px] text-subtle-foreground",
              )}
            >
              {formatCount(stage.value)}
            </p>
          </div>
        )
      })}
      <span className="sr-only">
        {formatCount(total)} tables in total across the three stages.
      </span>
    </div>
  )
}

/**
 * The one stage the batch is on.
 *
 * Nothing has a table yet — the files are still being read — so it is the
 * first. The moment any of them has one, the batch is making tables even
 * though the rest are still being read: the second card is where the work is,
 * and the first is a queue draining behind it. Only when nothing is left
 * anywhere is it the third.
 */
export function currentStage({
  detecting,
  processing,
  finished,
}: {
  detecting: number
  processing: number
  finished: number
}): PipelineStage {
  if (processing === 0 && finished === 0) return "detect"
  if (detecting > 0 || processing > 0) return "process"
  return "done"
}
