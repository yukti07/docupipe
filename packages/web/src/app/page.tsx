"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Suspense,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { ErrorState } from "@/components/common/ErrorState"
import { LoadingState } from "@/components/common/LoadingState"
import { AppHeader } from "@/components/quarry/AppHeader"
import { BatchCard } from "@/components/quarry/BatchCard"
import { DropStrip } from "@/components/quarry/DropStrip"
import { DropZone } from "@/components/quarry/DropZone"
import { IntroHero } from "@/components/quarry/IntroHero"
import { toFailure } from "@/lib/api"
import type { Failure } from "@/lib/api/types"
import { hasSeenIntro, markIntroSeen } from "@/lib/intro"
import { stageFiles } from "@/lib/preflight"
import { ensureSession, getPreviousUserId, newRequestId } from "@/lib/session"
import { stageForRequest } from "@/state/staged"
import { batchPatch, useWorkspaceRefresh } from "@/state/result"
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
  const sentinel = useRef<HTMLDivElement>(null)
  const pastCard = useScrolledPast(sentinel)

  // Storage is an external system, and this particular corner of it cannot
  // change under us during a visit. The server has no storage at all, so it
  // answers "seen": the intro then arrives on hydration rather than being
  // rendered and torn straight back down.
  const seenIntro = useSyncExternalStore(neverChanges, hasSeenIntro, () => true)
  // Set once it has played out or been skipped. There is no way back to it:
  // the intro is what this browser's first visit looks like, not a feature.
  const [dismissed, setDismissed] = useState(false)
  const introPlaying = !seenIntro && !dismissed

  function endIntro() {
    markIntroSeen()
    setDismissed(true)
  }

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
  const waking = userId ? null : "Waking up your workspace — one moment."

  // The cards are notes this browser wrote while it was watching each batch.
  // Anything left mid-run kept the note it had when the screen was closed, so
  // the list asks the server once about the batches it believes are running.
  useWorkspaceRefresh(userId, batches, (requestId, data) =>
    workspace.updateBatch(requestId, batchPatch(data)),
  )

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
        <AppHeader />
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
      <AppHeader />

      {introPlaying && <IntroHero onDone={endIntro} />}

      {/* Outside the padded column: the strip spans the window and does its
          own centring, so it reads as chrome rather than as page content. */}
      <DropStrip
        onFiles={onFiles}
        disabledReason={waking}
        shown={pastCard && !introPlaying}
      />

      <main className="mx-auto w-full max-w-[1100px] flex-1 px-6 pb-10 pt-6">
        {/* The drop zone is the page — it carries the visible heading, so the
            document heading is here for a screen reader and nowhere else. */}
        <h1 className="sr-only">Your workspace</h1>

        {/* What the strip watches for.
            It marks the TOP of the card, not the bottom. Under the card the
            strip arrived exactly as the card's last row left, which was the
            tidier line and was also unreachable: the card is 460px tall, so
            it asked for 542px of scroll, and a tall window with a handful of
            batches has nowhere near that much page to scroll. The strip then
            never appeared at all for most of the workspaces anybody has.
            Here it asks for the height of the header, which any scroll at all
            gives — and the card is on its way out by the time it arrives. */}
        <div ref={sentinel} aria-hidden className="h-px" />

        <DropZone onFiles={onFiles} disabledReason={waking} />

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
            <h2 className="text-[13px] font-medium text-subtle-foreground">History</h2>
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
              title="Nothing here yet"
              body="Every batch you drop will be listed here, newest first."
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

/** `useSyncExternalStore` needs a subscribe; nothing here ever emits. */
const neverChanges = () => () => {}

/**
 * Whether a marker element has scrolled off the top of the window.
 *
 * An observer rather than a scroll listener: the page scrolls the body, so a
 * listener would mean a threshold in pixels that has to be kept in step with
 * the card's height. A marker under the card needs no such number.
 */
function useScrolledPast(marker: RefObject<HTMLElement | null>): boolean {
  const [past, setPast] = useState(false)

  useEffect(() => {
    const node = marker.current
    // jsdom has no IntersectionObserver, and the strip is not what those tests
    // are about — without one the page simply renders it retracted.
    if (!node || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(
      ([entry]) => setPast(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [marker])

  return past
}

/** "Q3 invoices/invoice-1043.pdf" names the batch after the folder it came from. */
function batchName(location: string): string {
  const folder = location.includes("/") ? location.split("/")[0] : ""
  if (folder) return folder
  return `Batch of ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
}
