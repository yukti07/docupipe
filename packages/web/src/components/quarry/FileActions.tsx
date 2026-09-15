"use client"

import { RotateCw, Trash2, Upload } from "lucide-react"
import { useRef } from "react"
import { Button } from "@/components/ui/button"
import { formatBytes, formatCount } from "@/lib/format"
import { ACCEPT_ATTRIBUTE } from "@/lib/preflight"

/**
 * The line above the rows. It is where the batch is acted on — every failed
 * upload retried at once, the whole lot discarded, more files added — with the
 * weight of what is on screen kept on the right, out of the way.
 */
export function FileActions({
  fileCount,
  totalBytes,
  failedCount,
  onRetryAll,
  onDiscardFailed,
  onAddFiles,
}: {
  fileCount: number
  totalBytes: number
  /** Retrying and discarding only appear when there is something to act on. */
  failedCount: number
  onRetryAll: () => void
  onDiscardFailed: () => void
  onAddFiles: (files: File[]) => void
}) {
  const input = useRef<HTMLInputElement>(null)

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {failedCount > 0 && (
          <>
            <Button
              type="button"
              onClick={onRetryAll}
              className="h-9 gap-1.5 rounded-[10px] text-[13px] shadow-xs hover:bg-primary-hover"
            >
              <RotateCw aria-hidden className="size-3.5" />
              Retry all {formatCount(failedCount)}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onDiscardFailed}
              className="h-9 gap-1.5 rounded-[10px] bg-card text-[13px]"
            >
              <Trash2 aria-hidden className="size-3.5" />
              Discard them
            </Button>
          </>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={() => input.current?.click()}
          className="h-9 gap-1.5 rounded-[10px] bg-card text-[13px]"
        >
          <Upload aria-hidden className="size-3.5" />
          Drop more files
        </Button>

        {/* The real input, so the keyboard reaches everything the mouse does. */}
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          aria-label="Drop more files"
          className="sr-only"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ""
            if (files.length > 0) onAddFiles(files)
          }}
        />
      </div>

      <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
        <span className="tabular-nums text-subtle-foreground">{formatCount(fileCount)}</span>{" "}
        {fileCount === 1 ? "file" : "files"}{" "}
        <span aria-hidden>·</span>{" "}
        <span className="tabular-nums text-subtle-foreground">{formatBytes(totalBytes)}</span>
      </p>
    </>
  )
}
