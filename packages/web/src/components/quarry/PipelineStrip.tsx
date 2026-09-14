import type { ResultPollResponse } from "@/lib/api/types"
import { formatCount } from "@/lib/format"
import { cn } from "@/lib/utils"

type Counts = ResultPollResponse["counts"]

/**
 * Four stages and three connectors. The counts always sum to the batch total,
 * failures included — a stage that has lost a table shows up immediately as a
 * sum that no longer adds up, which is the point of rendering it this way.
 */
export function PipelineStrip({ counts, className }: { counts: Counts; className?: string }) {
  const total = counts.queued + counts.extracting + counts.filling + counts.done + counts.failed

  const stages = [
    { key: "queued", label: "Queued", value: counts.queued },
    { key: "extracting", label: "Extracting", value: counts.extracting },
    { key: "filling", label: "Filling", value: counts.filling },
    { key: "done", label: "Done", value: counts.done + counts.failed },
  ] as const

  return (
    <div
      className={cn("grid items-center gap-0", className)}
      style={{ gridTemplateColumns: "1fr 44px 1fr 44px 1fr 44px 1fr" }}
    >
      {stages.map((stage, index) => (
        <div key={stage.key} className="contents">
          {index > 0 && <Connector lit={stage.value > 0} />}
          <div
            data-stage={stage.key}
            data-active={stage.value > 0 || undefined}
            className={cn(
              "rounded-xl border px-3 py-2.5 text-center",
              stage.value > 0
                ? "border-primary-tint-border bg-primary-tint"
                : "border-border-faint bg-card",
            )}
          >
            <p className="font-mono text-[17px] tabular-nums leading-tight">
              {formatCount(stage.value)}
            </p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">{stage.label}</p>
            {stage.key === "done" && counts.failed > 0 && (
              <p className="mt-0.5 text-[11px] text-error-strong">
                {formatCount(counts.failed)} of them failed
              </p>
            )}
          </div>
        </div>
      ))}
      <span className="sr-only">
        {formatCount(total)} tables in total across the four stages.
      </span>
    </div>
  )
}

function Connector({ lit }: { lit: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mx-2 block h-px",
        // Motion is off under reduced motion; the counts keep updating regardless.
        lit ? "bg-primary-tint-strong motion-safe:animate-pulse" : "bg-border-faint",
      )}
    />
  )
}
