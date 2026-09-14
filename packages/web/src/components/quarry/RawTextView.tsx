"use client"

import { useCallback } from "react"
import { LoadingState } from "@/components/common/LoadingState"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import { api } from "@/lib/api"
import { formatCount } from "@/lib/format"
import { useAsync } from "@/lib/useAsync"

/**
 * The text as it came off the page, before any of it became fields. This is
 * what the machine view was for, kept as a per-table view rather than a screen.
 */
export function RawTextView({ requestId, schemaId }: { requestId: string; schemaId: string }) {
  const { data: raw, failure } = useAsync(
    `${requestId}:${schemaId}`,
    useCallback(() => api.getRawText(requestId, schemaId), [requestId, schemaId]),
  )

  if (failure) return <FailureMessage failure={failure} />
  if (!raw) return <LoadingState label="Reading the text off the pages" />

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-muted-foreground">
        The text as it came off {raw.fileName}, before any of it became fields.
      </p>
      {raw.pages.map((page) => (
        <section key={page.page}>
          <h3 className="mb-1.5 text-[11.5px] tabular-nums text-subtle-foreground">
            Page {formatCount(page.page)}
          </h3>
          <pre className="overflow-x-auto rounded-xl border border-border-subtle bg-card px-4 py-3 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap">
            {page.text}
          </pre>
        </section>
      ))}
    </div>
  )
}
