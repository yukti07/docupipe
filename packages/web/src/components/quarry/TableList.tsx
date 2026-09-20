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
  QUEUED: "converting",
  EXTRACTING: "converting",
  FILLING: "converting",
  DONE: "done",
  FAILED: "convert-failed",
}

/** A file the server has not answered for yet — a name, and nothing else. */
export type AwaitingFile = { fileId: string; fileName: string }

function detail(entry: ResultEntry): string | undefined {
  if (entry.stage === "DONE") {
    const parts = [`${formatCount(entry.rowCount ?? 0)} rows`]
    if (entry.fieldCount) parts.push(`${formatCount(entry.fieldCount)} fields`)
    if (entry.toCheckCount) parts.push(`${formatCount(entry.toCheckCount)} to check`)
    return parts.join(" · ")
  }
  // How far through it is, when the worker has said. The stage itself is not
  // repeated here: the row already says Converting, and "filling the table"
  // beside it was the same fact in the worker's words.
  if (entry.progress) {
    return `${entry.progress.unit} ${formatCount(entry.progress.at)} of ${formatCount(entry.progress.of)}`
  }
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
  awaiting = [],
  summary,
}: {
  requestId: string
  entries: ResultEntry[]
  /**
   * Files that are in this batch but have no table yet, in the order they were
   * dropped. Convert is not gated on shapes, so pressing it before they are all
   * back is ordinary — and a screen that listed only the tables would show an
   * eight-file batch as two rows and say nothing about the other six.
   */
  awaiting?: AwaitingFile[]
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
      {/* Under the tables, so a shape landing never pushes a row that is
          already being watched further down the screen. */}
      {awaiting.map((file) => (
        <FileRow key={`awaiting:${file.fileId}`} name={file.fileName} state="detecting" />
      ))}
    </FileList>
  )
}
