"use client"

import Link from "next/link"
import { use, useCallback, useEffect, useState } from "react"
import { ErrorState } from "@/components/common/ErrorState"
import { LoadingState } from "@/components/common/LoadingState"
import { BatchFooter } from "@/components/common/BatchFooter"
import { BatchShell } from "@/components/common/BatchShell"
import { railPhase } from "@/components/quarry/BatchNav"
import { MergePicker } from "@/components/quarry/MergePicker"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import type { MergeResult } from "@/lib/api/types"
import { forgetCached } from "@/lib/cache"
import { formatCount } from "@/lib/format"
import { ensureSession } from "@/lib/session"
import { useAsync } from "@/lib/useAsync"
import { useWorkspace } from "@/state/workspace"

export default function MergePage({ params }: PageProps<"/request/[requestId]/merge"> ) {
  const { requestId } = use(params)
  const [userId, setUserId] = useState<string | null>(null)
  const [merged, setMerged] = useState<Extract<MergeResult, { ok: true }> | null>(null)
  const { batches } = useWorkspace()

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
    <BatchShell
      requestId={requestId}
      current="results"
      done={{ files: true, schemas: true }}
      // Only a finished batch can be combined, so this screen is always past
      // the gate whether or not this browser watched it cross.
      phase={railPhase(batches.find((b) => b.requestId === requestId)?.phase ?? "done")}
      tail="Merge"
      footer={
        // Combining stays in the summary beside the selection it describes —
        // it is the one action on this screen that means nothing without the
        // ticks next to it. The footer carries the way out.
        <BatchFooter
          actions={
            <Button asChild variant="outline" className="h-10 rounded-[10px] bg-card text-[13px]">
              <Link href={`/request/${requestId}`}>Back to results</Link>
            </Button>
          }
        />
      }
    >
      <main className="mx-auto w-full max-w-[1080px] px-6 py-6">
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
            {/* A batch with several shapes has several merges in it. Leaving
                this screen and coming back was the only way to reach the next
                one. Going back to the batch is the footer's job. */}
            <Button
              onClick={() => {
                setMerged(null)
                reload()
              }}
              className="h-9 rounded-[10px]"
            >
              Combine more tables
            </Button>
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
    </BatchShell>
  )
}
