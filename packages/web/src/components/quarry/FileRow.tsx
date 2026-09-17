"use client"

import { AlignLeft, RotateCw } from "lucide-react"
import type { ReactNode } from "react"
import { StatusBadge, type StatusVariant } from "@/components/common/StatusBadge"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import { Button } from "@/components/ui/button"
import type { Failure } from "@/lib/api/types"
import { formatBytes } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * One component on two screens. S02 gives it Preview / Edit in the trailing
 * slot, S04 gives it View and Download. Building it twice is how the two
 * screens drift apart.
 */
export type FileRowState =
  // S02 — the upload, and nothing else. What a file's schema is doing shows on
  // the eye beside it, so the row never carries two clocks at once.
  | "staged"
  | "checking"
  | "rejected"
  | "uploading"
  | "failed"
  | "uploaded"
  // S04
  | "waiting"
  | "running"
  | "done"
  | "convert-failed"
  | "paused"

const STATES: Record<
  FileRowState,
  { label: string; variant: StatusVariant; icon?: typeof AlignLeft }
> = {
  // Three words cover the upload: in line, going up, landed. Signing is part of
  // going up — the file is being sent from the moment its url is asked for, and
  // a row that reads "In line" through that round trip is describing plumbing.
  staged: { label: "In line", variant: "neutral", icon: AlignLeft },
  checking: { label: "Uploading", variant: "working" },
  rejected: { label: "Rejected", variant: "error" },
  uploading: { label: "Uploading", variant: "working" },
  failed: { label: "Upload failed", variant: "error" },
  uploaded: { label: "Uploaded", variant: "success" },
  waiting: { label: "Waiting", variant: "neutral", icon: AlignLeft },
  running: { label: "Running", variant: "working" },
  done: { label: "Done", variant: "success" },
  // Distinct from `failed`, which is an upload that did not land.
  "convert-failed": { label: "Couldn't convert it", variant: "error" },
  paused: { label: "Paused", variant: "paused" },
}

export type FileRowProps = {
  name: string
  /** The folder path the file came from, when a folder was dropped. */
  location?: string
  size?: number
  state: FileRowState
  /** Sub-label under the name — "page 2 of 3", "14 rows · 6 fields". */
  detail?: string
  failure?: Failure
  onRetry?: () => void
  /** Preview / Edit on S02; View and Download on S04. */
  trailing?: ReactNode
  className?: string
}

export function FileRow({
  name,
  location,
  size,
  state,
  detail,
  failure,
  onRetry,
  trailing,
  className,
}: FileRowProps) {
  const { label, variant, icon } = STATES[state]
  const folder = location && location.includes("/") ? location.slice(0, location.lastIndexOf("/")) : null

  return (
    <div
      data-state={state}
      className={cn(
        "flex min-h-[56px] flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-faint bg-card px-4 py-2.5 last:border-b-0",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[12.5px] text-foreground">{name}</p>
        <p className="mt-0.5 truncate text-[11.5px] tabular-nums text-muted-foreground">
          {[folder, typeof size === "number" ? formatBytes(size) : null, detail]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {/* A state is a word next to a mark, not a chip. Pills stacked down a
          list read as decoration; these read as a column you can scan. */}
      <StatusBadge variant={variant} appearance="bare" icon={icon} className="shrink-0">
        {label}
      </StatusBadge>

      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="h-8 shrink-0 gap-1.5 rounded-lg bg-card text-[12.5px]"
        >
          <RotateCw aria-hidden className="size-3.5" />
          Retry
        </Button>
      )}

      {/* Present from the first frame, disabled until it works — an empty space
          says nothing, a disabled control says something is coming. */}
      {trailing && <div className="flex shrink-0 items-center gap-2">{trailing}</div>}

      {failure && (
        <div className="w-full">
          <FailureMessage failure={failure} compact className="mt-1 py-2" />
        </div>
      )}
    </div>
  )
}
