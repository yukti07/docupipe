"use client"

import { Loader2 } from "lucide-react"
import { GatedButton } from "@/components/common/GatedButton"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import type { Failure } from "@/lib/api/types"
import { formatCount } from "@/lib/format"
import { cn } from "@/lib/utils"

export type PrepareProgress = {
  uploaded: number
  total: number
  schemas: number
  /** Files that settled without a shape — counted as back, never as pending. */
  withoutShape: number
  uploading: boolean
  /** Files whose bytes are moving right now — never confused with the ones done. */
  inFlight: number
  /** 0–1 across the whole drop, by bytes, so a big file does not stall the bar. */
  fraction: number
}

/**
 * The one gate, and the batch's own progress. Convert enables when every file
 * has uploaded and *settled* its schema — ready or failed — and the server is
 * the authority on that, so the reason it gives is the reason shown.
 */
export function ConvertBar({
  readySchemaCount,
  convertAvailable,
  convertBlockedReason,
  converting,
  failure,
  progress,
  stalled,
  onReviewSchemas,
  onConvert,
  className,
}: {
  readySchemaCount: number
  convertAvailable: boolean
  convertBlockedReason: string | null
  converting?: boolean
  /** A 409 gate_not_met lands here and re-states the reason. */
  failure?: Failure | null
  /** Absent on a screen with no uploads of its own to report. */
  progress?: PrepareProgress
  /** The schema poll spent its budget with shapes still missing. */
  stalled?: boolean
  onReviewSchemas: () => void
  onConvert: () => void
  className?: string
}) {
  const reviewReason = readySchemaCount === 0 ? "No schemas ready yet" : null
  // No local override: the server's gate is arrival, not inspection, so it is
  // already open while shapes are still coming back.
  const convertReason = converting
    ? "Already converting"
    : convertAvailable
      ? null
      : (convertBlockedReason ?? "Waiting for every file to arrive")
  const working = Boolean(
    progress && !stalled && (progress.uploading || pendingShapes(progress) > 0),
  )

  return (
    <div className={cn("border-t border-border-subtle bg-card", className)}>
      {/* The batch's own bar, along the top edge of the footer: one line for
          the whole drop, where the per-file bars cannot be read at a glance. */}
      {progress && progress.total > 0 && (
        <div
          role="progressbar"
          aria-label="Uploading this batch"
          aria-valuenow={Math.round(progress.fraction * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-[3px] w-full bg-border-subtle"
        >
          <div
            className="h-full bg-primary transition-[width] duration-300"
            style={{ width: `${Math.min(100, progress.fraction * 100)}%` }}
          />
        </div>
      )}

      <div className="flex flex-col gap-3 px-6 py-3.5">
        {failure && <FailureMessage failure={failure} />}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {progress && progress.total > 0 && (
            <div className="flex min-w-0 items-center gap-2.5">
              {working && (
                <Loader2
                  aria-hidden
                  className="size-4 shrink-0 animate-spin text-primary"
                  strokeWidth={2}
                />
              )}
              {/* Two clocks, two lines: the bytes going up, and the shapes
                  coming back. Announced as they change, never focused. */}
              <div aria-live="polite" className="min-w-0">
                <p className="truncate text-[13px] font-medium tabular-nums">
                  {uploadLine(progress)}
                </p>
                <p
                  className={cn(
                    "truncate text-[12px] tabular-nums",
                    stalled ? "text-review" : "text-muted-foreground",
                  )}
                >
                  {stalled
                    ? "Taking longer than expected — you can convert without waiting."
                    : schemaLine(progress)}
                </p>
              </div>
            </div>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <GatedButton
              variant="outline"
              reason={reviewReason}
              hideReason
              onClick={onReviewSchemas}
              className="bg-card"
            >
              Review schemas
            </GatedButton>
            <GatedButton reason={convertReason} hideReason onClick={onConvert}>
              {converting
                ? "Converting…"
                : `Convert${readySchemaCount > 0 ? ` · ${formatCount(readySchemaCount)}` : ""}`}
            </GatedButton>
          </div>
        </div>
      </div>
    </div>
  )
}

const pendingShapes = (p: PrepareProgress) =>
  Math.max(0, p.uploaded - p.schemas - p.withoutShape)

function uploadLine({ uploaded, total, uploading, inFlight }: PrepareProgress): string {
  // "Uploading 2 of 3" reads as though two are in flight when two have landed.
  // The count of what is done and the count of what is moving are two numbers.
  const done = `${formatCount(uploaded)} of ${formatCount(total)} uploaded`
  if (uploading && inFlight > 0) return `${done} · ${formatCount(inFlight)} going up`
  return done
}

function schemaLine(progress: PrepareProgress): string {
  const { schemas, total, withoutShape } = progress
  const missing = withoutShape > 0 ? ` · ${formatCount(withoutShape)} without a shape` : ""
  return `${formatCount(schemas)} of ${formatCount(total)} schemas back${missing}`
}
