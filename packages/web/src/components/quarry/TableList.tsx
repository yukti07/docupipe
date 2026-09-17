"use client"

import { Download, Table2 } from "lucide-react"
import Link from "next/link"
import { FileList } from "@/components/quarry/FileList"
import { FileRow, type FileRowState } from "@/components/quarry/FileRow"
import { Button } from "@/components/ui/button"
import type { ResultEntry } from "@/lib/api/types"
import { formatCount } from "@/lib/format"
import type { ReactNode } from "react"

const STAGE: Record<ResultEntry["stage"], FileRowState> = {
  QUEUED: "waiting",
  EXTRACTING: "running",
  FILLING: "running",
  DONE: "done",
  FAILED: "convert-failed",
}

function detail(entry: ResultEntry): string | undefined {
  if (entry.stage === "DONE") {
    const parts = [`${formatCount(entry.rowCount ?? 0)} rows`]
    if (entry.fieldCount) parts.push(`${formatCount(entry.fieldCount)} fields`)
    if (entry.toCheckCount) parts.push(`${formatCount(entry.toCheckCount)} to check`)
    return parts.join(" · ")
  }
  if (entry.progress) {
    return `${entry.progress.unit} ${formatCount(entry.progress.at)} of ${formatCount(entry.progress.of)}`
  }
  if (entry.stage === "EXTRACTING") return "reading the pages"
  if (entry.stage === "FILLING") return "filling the table"
  return undefined
}

/**
 * The order never changes. A finished row gains View and Download in place, so
 * the row a user was looking at is still where they left it — re-sorting as
 * files land would move the target out from under them.
 */
export function TableList({
  requestId,
  entries,
  summary,
}: {
  requestId: string
  entries: ResultEntry[]
  summary?: ReactNode
}) {
  return (
    <FileList summary={summary}>
      {entries.map((entry) => (
        <FileRow
          key={`${entry.fileId}:${entry.schemaId}`}
          name={entry.fileName}
          state={STAGE[entry.stage]}
          detail={detail(entry)}
          failure={entry.stage === "FAILED" ? (entry.failure ?? { class: "unknown" }) : undefined}
          trailing={
            entry.stage === "DONE" ? (
              <>
                <Button
                  asChild
                  variant="secondary"
                  size="sm"
                  className="h-8 gap-1.5 rounded-lg text-[12.5px] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
                >
                  <Link href={`/request/${requestId}/table/${entry.schemaId}`}>
                    <Table2 aria-hidden className="size-3.5" />
                    View
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 rounded-lg text-[12.5px]"
                >
                  <Link href={`/request/${requestId}/table/${entry.schemaId}?download=1`}>
                    <Download aria-hidden className="size-3.5" />
                    Download
                  </Link>
                </Button>
              </>
            ) : undefined
          }
        />
      ))}
    </FileList>
  )
}
