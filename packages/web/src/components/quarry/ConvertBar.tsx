"use client"

import { Loader2 } from "lucide-react"
import Link from "next/link"
import { BatchFooter } from "@/components/common/BatchFooter"
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
  reviewHref,
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
  /** The review screen. A real href, so the route is prefetched before it is pressed. */
  reviewHref: string
  onConvert: () => void
  className?: string
}) {
  // Review is a route change, and leaving Prepare mid-upload abandons the rows
  // still going up — their bytes only live in this screen's state, and coming
  // back rebuilds the list from what the server has already confirmed.
  const reviewReason = progress?.uploading
    ? "Wait for the uploads to finish"
    : readySchemaCount === 0
      ? "No schemas ready yet"
      : null
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
    <BatchFooter
      className={className}
      // The batch's own bar, along the top edge of the footer: one line for
      // the whole drop, where the per-file bars cannot be read at a glance.
      progress={progress && progress.total > 0 ? progress.fraction : undefined}
      progressLabel="Uploading this batch"
      banner={failure ? <FailureMessage failure={failure} /> : undefined}
      status={
        progress && progress.total > 0 ? (
          <>
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
          </>
        ) : undefined
      }
      actions={
        <>
          {/* A link rather than a push: Next prefetches it while it sits in
              the footer, so pressing it does not begin by fetching the
              screen it is meant to open. */}
          <GatedButton
            asChild={reviewReason ? undefined : true}
            variant="outline"
            reason={reviewReason}
            hideReason
            className="bg-card"
          >
            {reviewReason ? "Review Schemas" : <Link href={reviewHref}>Review Schemas</Link>}
          </GatedButton>
          {/* No count. What is being converted is on the screen above, and a
              figure on the button only invites the reader to check it. */}
          <GatedButton reason={convertReason} hideReason onClick={onConvert}>
            {converting ? "Converting…" : "Convert"}
          </GatedButton>
        </>
      }
    />
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
