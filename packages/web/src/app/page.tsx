"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useEffectEvent, useState } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { ErrorState } from "@/components/common/ErrorState"
import { LoadingState } from "@/components/common/LoadingState"
import { AppHeader } from "@/components/quarry/AppHeader"
import { BatchCard } from "@/components/quarry/BatchCard"
import { DropZone } from "@/components/quarry/DropZone"
import { toFailure } from "@/lib/api"
import type { Failure } from "@/lib/api/types"
import { stageFiles } from "@/lib/preflight"
import { ensureSession, getPreviousUserId, newRequestId } from "@/lib/session"
import { stageForRequest } from "@/state/staged"
import { useWorkspace } from "@/state/workspace"

export default function WorkspacePage() {
  return (
    <Suspense fallback={<Waking />}>
      <Workspace />
    </Suspense>
  )
}

function Waking() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center">
      <LoadingState label="Waking up" />
    </main>
  )
}

function Workspace() {
  const router = useRouter()
  const params = useSearchParams()
  const { batches, loaded } = useWorkspace()
  const workspace = useWorkspace()

  const [attempt, setAttempt] = useState(0)
  // One piece of state, written only from the async callbacks, and read back
  // only when it belongs to the attempt being shown. Pressing Try again clears
  // the error by changing the attempt rather than by resetting state on the way
  // into the effect.
  const [session, setSession] = useState<{
    attempt: number
    userId?: string
    /** The id a `?w=` link replaced, read after the swap has been made. */
    previousId?: string | null
    failure?: Failure
  } | null>(null)

  // ?w=<userId> is the share mechanism — adopting it opens that whole workspace.
  const adopt = params.get("w")

  // A router identity that changes per render would re-run registration forever.
  const adopted = useEffectEvent(() => router.replace("/"))

  useEffect(() => {
    let live = true
    ensureSession(adopt)
      .then((id) => {
        if (!live) return
        setSession({ attempt, userId: id, previousId: getPreviousUserId() })
        if (adopt) adopted()
      })
      .catch((error: unknown) => {
        if (!live) return
        setSession({ attempt, failure: toFailure(error) })
      })
    return () => {
      live = false
    }
  }, [adopt, attempt])

  const current = session?.attempt === attempt ? session : null
  const userId = current?.userId ?? null
  const sessionFailure = current?.failure ?? null
  const previousId = current?.previousId ?? null

  function onFiles(files: File[]) {
    // The zone is inert without a session, so this cannot fire early. The guard
    // keeps that true if the zone's own gating ever changes.
    if (!userId) return

    const staged = stageFiles(files)
    const requestId = newRequestId()
    stageForRequest(requestId, staged)
    workspace.addBatch({
      requestId,
      name: batchName(staged[0]?.location ?? "New batch"),
      createdAt: new Date().toISOString(),
      fileCount: staged.length,
      phase: "prepare",
      summary: {},
    })
    router.push(`/request/${requestId}`)
  }

  if (sessionFailure) {
    return (
      <>
        <AppHeader userId={null} />
        <main className="flex flex-1 items-center justify-center p-6">
          <ErrorState
            title="Couldn't open your workspace"
            body="Your workspace lives in this browser, and the server has to know about it before a batch can start."
            onRetry={() => setAttempt((n) => n + 1)}
          />
        </main>
      </>
    )
  }

  return (
    <>
      <AppHeader userId={userId} />
      <main className="mx-auto w-full max-w-[1100px] flex-1 px-6 py-10">
        {/* The drop zone is the page — it carries the visible heading, so the
            document heading is here for a screen reader and nowhere else. */}
        <h1 className="sr-only">Your workspace</h1>

        <DropZone
          onFiles={onFiles}
          disabledReason={userId ? null : "Waking up your workspace — one moment."}
        />

        {/* Adopting a shared link swaps this browser's identity, and the
            batches that came with the old one went with it. */}
        {previousId && previousId !== userId && (
          <p className="mt-3 text-[12.5px] text-muted-foreground">
            This browser was in another workspace before this one.{" "}
            <Link
              href={`/?w=${previousId}`}
              className="font-medium text-foreground underline underline-offset-2"
            >
              Switch back to it
            </Link>
          </p>
        )}

        <section className="mt-10">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-medium text-subtle-foreground">Batches</h2>
            {loaded && batches.length > 0 && (
              <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-secondary-foreground">
                {batches.length}
              </span>
            )}
          </div>
          {!loaded ? (
            <LoadingState label="Reading your workspace" className="mt-4" />
          ) : batches.length === 0 ? (
            <EmptyState
              className="mt-3 rounded-xl border border-dashed border-border-subtle bg-card/50"
              title="No batches yet"
              body="The ones you start will be listed here, newest first."
            />
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {batches.map((batch) => (
                <li key={batch.requestId}>
                  <BatchCard batch={batch} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  )
}

/** "Q3 invoices/invoice-1043.pdf" names the batch after the folder it came from. */
function batchName(location: string): string {
  const folder = location.includes("/") ? location.split("/")[0] : ""
  if (folder) return folder
  return `Batch of ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
}
