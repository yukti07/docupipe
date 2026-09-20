import { Loader2 } from "lucide-react"
import { StatusBadge } from "@/components/common/StatusBadge"
import { cn } from "@/lib/utils"

/** Chip widths, fixed per card — a skeleton that reflows is a second wait. */
const CHIPS = [
  [92, 74, 60, 84, 52],
  [78, 96, 64, 70],
  [104, 62, 88, 56, 72, 48],
]

/**
 * A file the review screen knows about but has no shape for yet.
 *
 * It stands in the list beside the real cards rather than replacing the whole
 * screen with a skeleton: a batch of six files where two have come back is a
 * screen with two schemas on it, not a screen that is still loading. When this
 * file's shape lands it is grouped with whatever it matches and this card goes.
 *
 * The name is real. Only the fields are guessed at, because the fields are the
 * only part nobody knows yet.
 */
export function PendingSchemaCard({
  fileName,
  stalled,
  index = 0,
  className,
}: {
  /** Absent for a batch this browser did not start — then the name is a bar too. */
  fileName?: string
  /** The poll spent its budget. This shape is not on its way any more. */
  stalled?: boolean
  /** Varies the chip widths down the list, so three of these are not one block. */
  index?: number
  className?: string
}) {
  const chips = CHIPS[index % CHIPS.length]

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-border-subtle bg-card px-4 py-3.5",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {/* Holds the column the real cards' chevron sits in, so nothing shifts
            sideways when this card is replaced by one. */}
        <span aria-hidden className="mt-0.5 size-4 shrink-0" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {fileName ? (
              <p className="min-w-0 truncate font-mono text-[12px] text-subtle-foreground">
                {fileName}
              </p>
            ) : (
              <Bar className="h-[15px]" width={148} />
            )}
            {/* Bare while it is working: a batch of six should not wear six
                pills, and what is worth seeing on this card is which file is
                still out — not a block of colour repeated down the list. The
                one state that has gone wrong keeps its pill. */}
            <StatusBadge
              variant={stalled ? "review" : "success"}
              appearance={stalled ? "pill" : "bare"}
              icon={stalled ? undefined : Loader2}
              className="shrink-0"
            >
              {stalled ? "Taking longer than expected" : "Detecting"}
            </StatusBadge>
          </div>

          <ul aria-hidden className="mt-2.5 flex flex-wrap gap-1.5">
            {chips.map((width, chip) => (
              <li key={chip}>
                <Bar className="h-[21px]" width={width} />
              </li>
            ))}
          </ul>
        </div>
      </div>

      <span className="sr-only">
        {fileName ?? "A file in this batch"} —{" "}
        {stalled ? "its schema is taking longer than expected" : "its schema is still being read"}.
      </span>
    </section>
  )
}

/** `motion-safe` because the pulse is decoration; the block holds its space regardless. */
function Bar({ className, width }: { className?: string; width?: number }) {
  return (
    <div
      aria-hidden
      style={width ? { width } : undefined}
      className={cn("rounded-md bg-muted motion-safe:animate-pulse", className)}
    />
  )
}
