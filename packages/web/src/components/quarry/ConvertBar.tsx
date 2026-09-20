"use client"

import { Loader2 } from "lucide-react"
import Link from "next/link"
import { BatchFooter } from "@/components/common/BatchFooter"
import { GatedButton } from "@/components/common/GatedButton"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import type { Failure } from "@/lib/api/types"
import { formatCount } from "@/lib/format"

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
  const reviewReason = progress?.uploading ? "Wait for the uploads to finish" : null
  // No local override: the server's gate is arrival, not inspection, so it is
  // already open while shapes are still coming back.
  const convertReason = converting
    ? "Already converting"
    : convertAvailable
      ? null
      : (convertBlockedReason ?? "Waiting for every file to arrive")
  // The bytes, and nothing else. Reading the shapes carries on in the
  // background and neither of the buttons waits for it, so a spinner that kept
  // turning after the last file landed was reporting a wait nobody was in.
  const working = Boolean(progress && progress.uploading)

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
            {/* One clock: the bytes going up. Announced as it changes, never
                focused. */}
            <div aria-live="polite" className="min-w-0">
              <p className="truncate text-[13px] font-medium tabular-nums">
                {uploadLine(progress)}
              </p>
              {/* Only when something is wrong. The count of shapes back was
                  here, and it was a number nobody could act on: reviewing and
                  converting are both open whatever it says. */}
              {stalled && (
                <p className="truncate text-[12px] text-review">
                  Taking longer than expected — you can convert without waiting.
                </p>
              )}
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


// One number, and the one anybody acts on: how much of the drop has landed.
// The count of files whose bytes are moving right now was beside it, and it
// said nothing the first number and the bar above it do not already say.
const uploadLine = ({ uploaded, total }: PrepareProgress): string =>
  `${formatCount(uploaded)} of ${formatCount(total)} uploaded`

