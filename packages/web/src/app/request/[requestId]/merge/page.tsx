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
import { forgetCached } from "@/lib/cache"
import { formatCount } from "@/lib/format"
import { ensureSession } from "@/lib/session"
import { useAsync } from "@/lib/useAsync"

export default function MergePage({ params }: PageProps<"/request/[requestId]/merge"> ) {
  const { requestId } = use(params)
  const [userId, setUserId] = useState<string | null>(null)
  const [merged, setMerged] = useState<Extract<MergeResult, { ok: true }> | null>(null)

  const {
    data: overview,
    failure,
    reload,
  } = useAsync(
    requestId,
    useCallback(() => api.getMergeOverview(requestId), [requestId]),
  )

  useEffect(() => {
    void ensureSession().then(setUserId)
  }, [])

  // The batch screen serves its last poll from a cache while the next one is in
  // flight. A merge changes which tables that list contains, so a stale answer
  // would show the members again beside the table that replaced them.
  const invalidateBatch = useCallback(() => forgetCached(requestId), [requestId])

  return (
    <>
      <AppHeader userId={userId}>
        <div className="min-w-0">
          <p className="truncate text-[12px] text-muted-foreground">
            <Link href={`/request/${requestId}`} className="hover:underline">
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
            backHref={`/request/${requestId}`}
          />
        )}

        {!overview && !failure && <LoadingState label="Reading the finished tables" />}

        {merged ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-border-subtle bg-card p-6">
            <p className="text-[15px] font-medium">
              {formatCount(merged.merges.length)} merged{" "}
              {merged.merges.length === 1 ? "table" : "tables"}
            </p>
            <ul className="flex flex-col gap-1 text-[13px] tabular-nums text-subtle-foreground">
              {merged.merges.map((merge) => (
                <li key={merge.mergeId}>
                  <Link
                    href={`/request/${requestId}/table/${merge.mergeId}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {merge.name}
                  </Link>{" "}
                  — {formatCount(merge.rowCount)} rows from {formatCount(merge.tableCount)}{" "}
                  tables
                </li>
              ))}
            </ul>
            <p className="text-[13px] tabular-nums text-subtle-foreground">
              {formatCount(merged.tableCount)} tables in this batch now.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild className="h-9 rounded-[10px]">
                <Link href={`/request/${requestId}`}>Back to the batch</Link>
              </Button>
              {/* A batch with several shapes has several merges in it. Leaving
                  this screen and coming back was the only way to reach the
                  next one. */}
              <Button
                variant="outline"
                onClick={() => {
                  setMerged(null)
                  reload()
                }}
                className="h-9 rounded-[10px] bg-card"
              >
                Combine more tables
              </Button>
            </div>
          </div>
        ) : (
          overview && (
            <MergePicker
              overview={overview}
              // The session is read on mount and is all but always there by
              // the time anything is ticked. Saying so beats sending an empty
              // id the server would reject with a sentence about validation.
              onMerge={async (merges) =>
                userId
                  ? api.createMerges(userId, requestId, merges)
                  : { ok: false, failure: { class: "network" }, conflicts: [] }
              }
              onUndo={async (mergeId) => {
                if (!userId) return
                await api.deleteMerge(userId, requestId, mergeId)
                invalidateBatch()
                reload()
              }}
              onMerged={(result) => {
                invalidateBatch()
                setMerged(result)
              }}
            />
          )
        )}
      </main>
    </>
  )
}
