"use client"

import Link from "next/link"
import { use, useCallback, useEffect, useState } from "react"
import { ErrorState } from "@/components/common/ErrorState"
import { LoadingState } from "@/components/common/LoadingState"
import { AppHeader } from "@/components/quarry/AppHeader"
import { MergePicker } from "@/components/quarry/MergePicker"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import type { MergeResult } from "@/lib/api/types"
import { formatCount } from "@/lib/format"
import { ensureSession } from "@/lib/session"
import { useAsync } from "@/lib/useAsync"

export default function MergePage({ params }: PageProps<"/b/[requestId]/merge">) {
  const { requestId } = use(params)
  const [userId, setUserId] = useState<string | null>(null)
  const [merged, setMerged] = useState<Extract<MergeResult, { ok: true }> | null>(null)

  const {
    data: groups,
    failure,
    reload,
  } = useAsync(
    requestId,
    useCallback(() => api.getMergeGroups(requestId), [requestId]),
  )

  useEffect(() => {
    void ensureSession().then(setUserId)
  }, [])

  return (
    <>
      <AppHeader userId={userId}>
        <div className="min-w-0">
          <p className="truncate text-[12px] text-muted-foreground">
            <Link href={`/b/${requestId}`} className="hover:underline">
              Back to the batch
            </Link>
          </p>
          <p className="truncate text-[13px] font-medium">Combine tables</p>
        </div>
      </AppHeader>

      <main className="mx-auto w-full max-w-[1080px] flex-1 px-6 py-6">
        {failure && (
          <ErrorState
            title="Couldn't list the finished tables"
            body="Nothing has been combined, and nothing is lost."
            onRetry={reload}
            backHref={`/b/${requestId}`}
          />
        )}

        {!groups && !failure && <LoadingState label="Reading the finished tables" />}

        {merged ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-border-subtle bg-card p-6">
            <p className="text-[15px] font-medium">{merged.name}</p>
            <p className="text-[13px] tabular-nums text-subtle-foreground">
              {formatCount(merged.rowCount)} rows from {formatCount(merged.tableCount)} tables, in
              one table.
            </p>
            <Button asChild className="h-9 rounded-[10px]">
              <Link href={`/b/${requestId}/t/${merged.mergeId}`}>Open the merged table</Link>
            </Button>
          </div>
        ) : (
          groups && (
            <MergePicker
              groups={groups}
              onMerge={(schemaIds, name) => api.createMerge(requestId, schemaIds, name)}
              onMerged={setMerged}
            />
          )
        )}
      </main>
    </>
  )
}
