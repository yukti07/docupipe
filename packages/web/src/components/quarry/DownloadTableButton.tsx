"use client"

import { Download } from "lucide-react"
import { useState } from "react"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import { Button } from "@/components/ui/button"
import type { Failure, TableData } from "@/lib/api/types"
import { csvFileName, downloadText, toCsv } from "@/lib/csv"
import { cn } from "@/lib/utils"

/**
 * One click, no dialog. You are looking at the table, so you already know what
 * is in it — the asymmetry with Download all is deliberate.
 */
export function DownloadTableButton({
  table,
  className,
}: {
  table: TableData
  className?: string
}) {
  const [failure, setFailure] = useState<Failure | null>(null)

  function download() {
    setFailure(null)
    try {
      const { text } = toCsv(table)
      downloadText(csvFileName(table.fileName), text)
    } catch {
      setFailure({
        class: "unknown",
        message: "Couldn't build the file.",
        nextStep: "Try the download again.",
      })
    }
  }

  return (
    <div className={cn("flex flex-col items-end gap-2", className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={download}
        className="h-8 gap-1.5 rounded-lg bg-card text-[12.5px]"
      >
        <Download aria-hidden className="size-3.5" />
        Download
      </Button>
      {failure && <FailureMessage failure={failure} compact />}
    </div>
  )
}
