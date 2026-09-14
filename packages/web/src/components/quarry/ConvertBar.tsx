"use client"

import { GatedButton } from "@/components/common/GatedButton"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import type { Failure } from "@/lib/api/types"
import { formatCount } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The one gate. Convert enables when every file has uploaded and *settled* its
 * schema — ready or failed — and the server is the authority on that, so the
 * reason it gives is the reason shown.
 */
export function ConvertBar({
  readySchemaCount,
  convertAvailable,
  convertBlockedReason,
  converting,
  failure,
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
  onReviewSchemas: () => void
  onConvert: () => void
  className?: string
}) {
  const reviewReason = readySchemaCount === 0 ? "No schemas ready yet" : null
  const convertReason = converting
    ? "Already converting"
    : convertAvailable
      ? null
      : (convertBlockedReason ?? "Waiting for every file to settle its shape")

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-t border-border-subtle bg-card px-6 py-3.5",
        className,
      )}
    >
      {failure && <FailureMessage failure={failure} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <GatedButton variant="outline" reason={reviewReason} onClick={onReviewSchemas}>
          Review schemas
        </GatedButton>
        <GatedButton reason={convertReason} onClick={onConvert}>
          {converting
            ? "Converting…"
            : `Convert${readySchemaCount > 0 ? ` · ${formatCount(readySchemaCount)}` : ""}`}
        </GatedButton>
      </div>
    </div>
  )
}
