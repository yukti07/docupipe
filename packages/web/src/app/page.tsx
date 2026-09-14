"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useEffectEvent, useState } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { ErrorState } from "@/components/common/ErrorState"
import { LoadingState } from "@/components/common/LoadingState"
import { AppHeader } from "@/components/quarry/AppHeader"
import { BatchCard } from "@/components/quarry/BatchCard"
import { DropZone } from "@/components/quarry/DropZone"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import { ApiError } from "@/lib/api"
import type { Failure } from "@/lib/api/types"
import { stageFiles } from "@/lib/preflight"
import { ensureSession, newRequestId } from "@/lib/session"
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

  const [dropFailure, setDropFailure] = useState<Failure | null>(null)
  const [attempt, setAttempt] = useState(0)
  // One piece of state, written only from the async callbacks, and read back
  // only when it belongs to the attempt being shown. Pressing Try again clears
  // the error by changing the attempt rather than by resetting state on the way
  // into the effect.
  const [session, setSession] = useState<{
    attempt: number
    userId?: string
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
        setSession({ attempt, userId: id })
        if (adopt) adopted()
      })
      .catch((error: unknown) => {
        if (!live) return
        setSession({
          attempt,
          failure: error instanceof ApiError ? error.failure : { class: "unknown" },
        })
      })
    return () => {
      live = false
    }
  }, [adopt, attempt])

  const current = session?.attempt === attempt ? session : null
  const userId = current?.userId ?? null
  const sessionFailure = current?.failure ?? null

  function onFiles(files: File[]) {
    setDropFailure(null)
    if (!userId) {
      setDropFailure({
        class: "network",
        message: "Your workspace hasn't finished waking up.",
        nextStep: "Give it a moment and drop the files again.",
      })
      return
    }

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
    router.push(`/b/${requestId}`)
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
      <main className="mx-auto w-full max-w-[1080px] flex-1 px-6 py-8">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Your workspace</h1>
        <p className="mt-1 max-w-prose text-[13px] text-subtle-foreground">
          Drop a pile of documents in. Each one is read on its own and tells you what its table
          looks like, before anything is converted.
        </p>

        <div className="mt-6">
          <DropZone
            onFiles={onFiles}
            disabledReason={userId ? null : "Waking up your workspace — one moment."}
          />
          {dropFailure && <FailureMessage failure={dropFailure} className="mt-3" />}
        </div>

        <section className="mt-10">
          <h2 className="text-[13px] font-medium text-subtle-foreground">Batches</h2>
          {!loaded ? (
            <LoadingState label="Reading your workspace" className="mt-4" />
          ) : batches.length === 0 ? (
            <EmptyState
              className="rounded-xl border border-border-faint bg-card/60"
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
