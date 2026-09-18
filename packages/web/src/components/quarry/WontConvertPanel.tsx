"use client"

import { Trash2 } from "lucide-react"
import { useState } from "react"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import { Button } from "@/components/ui/button"
import type { Failure } from "@/lib/api/types"
import { formatCount } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Files that settled without a shape. They are named here rather than hidden,
 * and they do not block Convert — they are carried through as failures.
 *
 * Discard is the way out. Without it the only thing this panel ever offered was
 * the news that a file was stuck, on a screen that would keep saying so until
 * the batch was abandoned. It takes the file out of the request for good, which
 * is what "it won't convert" was always going to mean in the end.
 */
export function WontConvertPanel({
  entries,
  onDiscard,
  className,
}: {
  entries: { fileId: string; fileName: string; failure: Failure }[]
  /** Absent once converting has started — there is nothing left to take out. */
  onDiscard?: (fileIds: string[]) => Promise<unknown>
  className?: string
}) {
  const [busy, setBusy] = useState<string | null>(null)

  if (entries.length === 0) return null

  const discard = async (key: string, fileIds: string[]) => {
    if (!onDiscard) return
    setBusy(key)
    try {
      await onDiscard(fileIds)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={cn("rounded-xl border border-border-subtle bg-card p-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium">
            {formatCount(entries.length)} {entries.length === 1 ? "file" : "files"} won&apos;t
            convert
          </h3>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            These carry on as failures rather than holding up the rest. Convert stays available.
          </p>
        </div>

        {onDiscard && entries.length > 1 && (
          <Button
            type="button"
            variant="outline"
            disabled={busy !== null}
            onClick={() => discard("all", entries.map((entry) => entry.fileId))}
            className="h-8 shrink-0 gap-1.5 rounded-lg bg-card text-[12.5px]"
          >
            <Trash2 aria-hidden className="size-3.5" />
            {busy === "all" ? "Discarding…" : `Discard all ${formatCount(entries.length)}`}
          </Button>
        )}
      </div>

      <ul className="mt-3 flex flex-col gap-2">
        {entries.map((entry) => (
          <li key={entry.fileId}>
            <div className="flex items-center gap-3">
              <p className="min-w-0 flex-1 truncate font-mono text-[12px]">{entry.fileName}</p>
              {onDiscard && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => discard(entry.fileId, [entry.fileId])}
                  className="h-8 shrink-0 gap-1.5 rounded-lg text-[12.5px]"
                >
                  <Trash2 aria-hidden className="size-3.5" />
                  {busy === entry.fileId ? "Discarding…" : "Discard"}
                </Button>
              )}
            </div>
            <FailureMessage failure={entry.failure} className="mt-1" />
          </li>
        ))}
      </ul>
    </section>
  )
}
