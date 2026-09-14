"use client"

import { Download } from "lucide-react"
import { useState } from "react"
import { GatedButton } from "@/components/common/GatedButton"
import { LoadingState } from "@/components/common/LoadingState"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { api } from "@/lib/api"
import type { Failure, ResultPollResponse } from "@/lib/api/types"
import { csvFileName, downloadText, toCsv, type Delimiter } from "@/lib/csv"
import { formatCount } from "@/lib/format"

/**
 * The one that leaves the building, so it says what it contains *before* the
 * download rather than after — including the unflattering parts.
 */
export function DownloadAllDialog({
  requestId,
  result,
}: {
  requestId: string
  result: ResultPollResponse
}) {
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<Delimiter>(",")
  const [preparing, setPreparing] = useState(false)
  const [done, setDone] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)

  const finished = result.files.filter((file) => file.stage === "DONE")
  const rows = finished.reduce((sum, file) => sum + (file.rowCount ?? 0), 0)
  const toCheck = finished.reduce((sum, file) => sum + (file.toCheckCount ?? 0), 0)
  const failed = result.counts.failed

  const reason =
    finished.length === 0
      ? failed > 0
        ? "Every file failed, so there is nothing to download"
        : "No table has finished yet"
      : null

  async function download() {
    setPreparing(true)
    setFailure(null)
    try {
      const tables = await Promise.all(
        finished.map((file) => api.getTable(requestId, file.schemaId)),
      )
      for (const table of tables) {
        const { text } = toCsv(table, { delimiter: format })
        downloadText(
          csvFileName(table.fileName, format === "," ? "csv" : "tsv"),
          text,
          format === "," ? "text/csv;charset=utf-8" : "text/tab-separated-values;charset=utf-8",
        )
      }
      setDone(true)
    } catch {
      setFailure({
        class: "unknown",
        message: "Couldn't build the files.",
        nextStep: "Try the download again.",
      })
    } finally {
      setPreparing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <span>
          <GatedButton
            reason={reason}
            variant="outline"
            className="h-8 gap-1.5 rounded-lg bg-card text-[12.5px]"
          >
            <Download aria-hidden className="size-3.5" />
            Download all · {formatCount(rows)} rows
          </GatedButton>
        </span>
      </DialogTrigger>

      <DialogContent className="max-w-[520px] rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-[16px]">Download this batch</DialogTitle>
          <DialogDescription className="text-[13px]">
            One file per table, generated here in your browser from the rows already on screen.
          </DialogDescription>
        </DialogHeader>

        {/* The honest summary, before the download and not after it. */}
        <ul className="flex flex-col gap-1 rounded-xl border border-border-subtle bg-muted px-4 py-3 text-[13px] tabular-nums">
          <li>
            {formatCount(rows)} rows across {formatCount(finished.length)} tables
          </li>
          {failed > 0 && <li className="text-error-strong">{formatCount(failed)} files failed</li>}
          {toCheck > 0 && <li className="text-review">{formatCount(toCheck)} cells worth a look</li>}
          <li className="text-muted-foreground">
            Values that were not in the document export as an empty cell, never as a zero.
          </li>
        </ul>

        <fieldset className="flex items-center gap-2">
          <legend className="sr-only">File format</legend>
          {(
            [
              [",", "CSV"],
              ["\t", "Tab separated"],
            ] as [Delimiter, string][]
          ).map(([value, label]) => (
            <Button
              key={label}
              type="button"
              variant={format === value ? "default" : "outline"}
              size="sm"
              aria-pressed={format === value}
              onClick={() => setFormat(value)}
              className="h-8 rounded-lg text-[12.5px]"
            >
              {label}
            </Button>
          ))}
        </fieldset>

        {preparing && <LoadingState label="Building your files" />}
        {failure && <FailureMessage failure={failure} />}
        {done && !preparing && (
          <p role="status" className="text-[12.5px] text-subtle-foreground">
            Downloaded. Check your browser&apos;s downloads folder.
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} className="h-9 rounded-[10px]">
            Close
          </Button>
          <Button onClick={download} disabled={preparing} className="h-9 rounded-[10px]">
            {preparing ? "Preparing…" : "Download"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
