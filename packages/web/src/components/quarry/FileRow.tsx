"use client"

import { RotateCw } from "lucide-react"
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
  // S02
  | "staged"
  | "checking"
  | "rejected"
  | "uploading"
  | "failed"
  | "uploaded"
  | "reading-shape"
  | "shape-ready"
  | "no-shape"
  | "unreadable"
  // S04
  | "waiting"
  | "running"
  | "done"
  | "convert-failed"
  | "paused"

const STATES: Record<FileRowState, { label: string; variant: StatusVariant }> = {
  staged: { label: "Staged", variant: "neutral" },
  checking: { label: "Checking", variant: "working" },
  rejected: { label: "Rejected", variant: "error" },
  uploading: { label: "Uploading", variant: "working" },
  failed: { label: "Upload failed", variant: "error" },
  uploaded: { label: "Uploaded", variant: "neutral" },
  "reading-shape": { label: "Reading shape", variant: "working" },
  // C3 — a finished chip is neutral; the accent is not a status.
  "shape-ready": { label: "Shape ready", variant: "neutral" },
  "no-shape": { label: "No table found", variant: "error" },
  unreadable: { label: "Couldn't read it", variant: "error" },
  waiting: { label: "Waiting", variant: "neutral" },
  running: { label: "Running", variant: "working" },
  done: { label: "Done", variant: "neutral" },
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
  progress?: { loaded: number; total: number }
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
  progress,
  failure,
  onRetry,
  trailing,
  className,
}: FileRowProps) {
  const { label, variant } = STATES[state]
  const folder = location && location.includes("/") ? location.slice(0, location.lastIndexOf("/")) : null
  // Only while it is actually uploading. A half-drawn bar beside a row that has
  // already landed says the opposite of what is true.
  const fraction =
    state === "uploading" && progress && progress.total > 0
      ? Math.min(1, progress.loaded / progress.total)
      : null

  return (
    <div
      data-state={state}
      className={cn(
        "flex min-h-[56px] flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-faint px-4 py-2.5 last:border-b-0",
        state === "rejected" || state === "failed" ? "bg-error-bg/40" : "bg-card",
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

      {fraction !== null && (
        <div
          role="progressbar"
          aria-label={`Uploading ${name}`}
          aria-valuenow={Math.round(fraction * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-[5px] w-28 shrink-0 overflow-hidden rounded-full bg-border-subtle"
        >
          <div className="h-full bg-primary transition-[width]" style={{ width: `${fraction * 100}%` }} />
        </div>
      )}

      <StatusBadge variant={variant} className="shrink-0">
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
