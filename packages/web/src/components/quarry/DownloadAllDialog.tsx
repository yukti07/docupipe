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
import type { Failure, ResultPollResponse, TableData } from "@/lib/api/types"
import { csvFileName, downloadText, sourceColumnFor, toCsv, type Delimiter } from "@/lib/csv"
import { formatCount } from "@/lib/format"
import { downloadBlob, toWorkbook } from "@/lib/xlsx"

/** One file per table, or one workbook holding the lot. */
type Format = Delimiter | "xlsx"

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
  const [format, setFormat] = useState<Format>(",")
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

  /**
   * One workbook, one sheet per table. A merged table is one table here as it
   * is everywhere else — the result poll has already put it in this list in
   * place of the tables it was made from — so it is one sheet, not several.
   */
  async function writeWorkbook(tables: TableData[]) {
    if (tables.length === 0) return
    const blob = await toWorkbook(
      tables.map((table) => ({
        name: table.fileName,
        fields: table.fields,
        rows: table.rows,
        sourceColumn: sourceColumnFor(table),
      })),
    )
    downloadBlob(`quarry-${requestId}.xlsx`, blob)
  }

  function writeSeparateFiles(tables: TableData[], delimiter: Delimiter) {
    for (const table of tables) {
      const { text } = toCsv(table, {
        delimiter,
        sourceColumn: sourceColumnFor(table)?.value,
      })
      downloadText(
        csvFileName(table.fileName, delimiter === "," ? "csv" : "tsv"),
        text,
        delimiter === ","
          ? "text/csv;charset=utf-8"
          : "text/tab-separated-values;charset=utf-8",
      )
    }
  }

  async function download() {
    setPreparing(true)
    setFailure(null)
    setDone(false)
    try {
      // Settled, not all: one table that will not come back is a reason to be
      // short a file, never a reason to throw away the nineteen that did.
      const answers = await Promise.allSettled(
        finished.map((file) => api.getTable(requestId, file.schemaId)),
      )
      const tables = answers.flatMap((answer) =>
        answer.status === "fulfilled" ? [answer.value] : [],
      )
      if (format === "xlsx") await writeWorkbook(tables)
      else writeSeparateFiles(tables, format)
      setDone(tables.length > 0)
      const missing = answers.length - tables.length
      if (missing > 0) {
        setFailure({
          class: "unknown",
          message:
            tables.length === 0
              ? "Couldn't build the files."
              : `${formatCount(tables.length)} of ${formatCount(answers.length)} tables downloaded. ${formatCount(missing)} couldn't be built.`,
          nextStep: "Try the download again for the ones that are missing.",
        })
      }
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
          {/* The same height as Merge beside it. Two footer buttons of
              different heights read as two different kinds of control. */}
          <GatedButton
            reason={reason}
            variant="outline"
            className="h-10 gap-1.5 rounded-[10px] bg-card text-[13px]"
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
            {format === "xlsx"
              ? "One spreadsheet, one sheet per table — generated here in your browser."
              : "One file per table, generated here in your browser from the rows already on screen."}
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
              ["xlsx", "Spreadsheet"],
            ] as [Format, string][]
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

        {preparing && (
          <LoadingState
            label={format === "xlsx" ? "Building your spreadsheet" : "Building your files"}
          />
        )}
        {failure && <FailureMessage failure={failure} />}
        {done && !failure && !preparing && (
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
