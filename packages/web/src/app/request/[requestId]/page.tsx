"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { use, useCallback, useEffect, useMemo, useState } from "react"
import { BatchFooter } from "@/components/common/BatchFooter"
import { BatchShell } from "@/components/common/BatchShell"
import { EmptyState } from "@/components/common/EmptyState"
import { GatedButton } from "@/components/common/GatedButton"
import { railPhase, type BatchPhase } from "@/components/quarry/BatchNav"
import { ConvertBar } from "@/components/quarry/ConvertBar"
import { ConvertingSkeleton } from "@/components/quarry/ConvertingSkeleton"
import { DownloadAllDialog } from "@/components/quarry/DownloadAllDialog"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import { FileActions } from "@/components/quarry/FileActions"
import { FileList } from "@/components/quarry/FileList"
import { FileRow, type FileRowState } from "@/components/quarry/FileRow"
import { PausedBanner } from "@/components/quarry/PausedBanner"
import { PipelineStrip } from "@/components/quarry/PipelineStrip"
import { StatusSentence } from "@/components/quarry/StatusSentence"
import { TableList, type AwaitingFile } from "@/components/quarry/TableList"
import { WontConvertPanel } from "@/components/quarry/WontConvertPanel"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import type { Failure } from "@/lib/api/types"
import { forgetCached, readCachedResult } from "@/lib/cache"
import { formatCount } from "@/lib/format"
import {
  allShapesSettled,
  partitionFailures,
  type SchemaState,
  type TableFailure,
} from "@/lib/schema"
import { ensureSession } from "@/lib/session"
import { useAsync } from "@/lib/useAsync"
import { useBatch, type BatchFile } from "@/state/batch"
import { forgetFiles, readRememberedFiles, readUnreadable } from "@/state/batchFiles"
import {
  batchPatch,
  RESULT_WARMUP_MS,
  useConversionProbe,
  useResultPolling,
} from "@/state/result"
import { useWorkspace } from "@/state/workspace"

const UPLOAD_STAGE: Record<BatchFile["stage"], FileRowState> = {
  staged: "staged",
  checking: "checking",
  rejected: "rejected",
  uploading: "uploading",
  uploaded: "uploaded",
  failed: "failed",
}

export default function BatchPage({ params, searchParams }: PageProps<"/request/[requestId]">) {
  const { requestId } = use(params)
  // The rail's Files step points here with `?view=files` once the batch has
  // converted. The files are still worth looking at then — what was dropped,
  // and what shape each one gave up — so the screen comes back, read-only.
  const wantsFiles = use(searchParams).view === "files"
  const [userId, setUserId] = useState<string | null>(null)
  const { batches, updateBatch } = useWorkspace()
  const batch = batches.find((b) => b.requestId === requestId)

  useEffect(() => {
    void ensureSession().then(setUserId)
  }, [])

  // The note this browser wrote when Convert was pressed. It renders first so
  // there is no flash, but it is only a guess — it is missing entirely when the
  // workspace link was opened somewhere else.
  const noted =
    batch?.phase === "converting" ||
    batch?.phase === "paused" ||
    batch?.phase === "done" ||
    batch?.phase === "failed"

  // The server is the authority: it holds a stage for every file in the
  // request. A probe that finds work queued promotes the screen even when this
  // browser has no note. It never demotes — a single failed or empty response
  // must not throw someone out of a batch they know has converted.
  // Only ask the server which phase this is when this browser cannot answer.
  // Any note at all — Prepare or Converting — is this browser's own record of
  // what it did, and asking adds nothing to it.
  const probe = useConversionProbe(requestId, batch ? null : userId)
  const converting = probe === "started" || noted

  useEffect(() => {
    if (probe === "started" && !noted) updateBatch(requestId, { phase: "converting" })
  }, [noted, probe, requestId, updateBatch])

  return converting && !wantsFiles ? (
    <Converting
      requestId={requestId}
      userId={userId}
      convertedAt={batch?.convertedAt}
      onPhase={updateBatch}
    />
  ) : (
    <Prepare
      requestId={requestId}
      userId={userId}
      // Everything the shape of this batch is made of is fixed the moment the
      // work starts. The screen still opens; nothing on it can be changed.
      frozen={converting}
      phase={railPhase(batch?.phase)}
      onPhase={updateBatch}
    />
  )
}

type PhaseWriter = ReturnType<typeof useWorkspace>["updateBatch"]

/* ------------------------------------------------------------------ */
/* Prepare — files up, shapes back, the gate                           */
/* ------------------------------------------------------------------ */

function Prepare({
  requestId,
  userId,
  frozen,
  phase,
  onPhase,
}: {
  requestId: string
  userId: string | null
  /** Reached from the rail after the gate: a record, not a workspace. */
  frozen?: boolean
  phase: BatchPhase
  onPhase: PhaseWriter
}) {
  const batch = useBatch(requestId, userId)
  const router = useRouter()
  const { removeBatch } = useWorkspace()
  const [converting, setConverting] = useState(false)
  const [convertFailure, setConvertFailure] = useState<Failure | null>(null)

  async function convert() {
    setConverting(true)
    setConvertFailure(null)
    const result = await batch.convert()
    if (!result.ok) {
      setConverting(false)
      setConvertFailure(result.failure)
      return
    }
    // The moment it was pressed, so the result poll can wait out the rest of
    // its two minutes even if the page is reloaded halfway through.
    onPhase(requestId, { phase: "converting", convertedAt: new Date().toISOString() })
  }

  const totalBytes = batch.files.reduce((sum, file) => sum + file.size, 0)

  // Discarding the last row leaves a batch with nothing in it, and a card for
  // an empty batch is a promise the workspace cannot keep.
  function discardFailed() {
    if (batch.discardFailed() > 0) return
    closeBatch()
  }

  /** The same ending, for files the server has now been told to forget. */
  async function discardFiles(fileIds: string[]) {
    if ((await batch.discardFiles(fileIds)) > 0) return
    closeBatch()
  }

  function closeBatch() {
    forgetFiles(requestId)
    forgetCached(requestId)
    removeBatch(requestId)
    router.push("/")
  }

  // Files, not tables: a file that held ten tables is one shape coming back.
  const filesWithShape = new Set(batch.schemas.map((s) => s.fileId)).size
  const progress = {
    uploaded: batch.uploadedCount,
    total: batch.acceptedCount,
    schemas: filesWithShape,
    withoutShape: batch.wontConvert.length,
    uploading: batch.uploading,
    inFlight: batch.files.filter((f) => f.stage === "uploading" || f.stage === "checking").length,
    fraction: uploadFraction(batch.files),
  }

  // The nav's first two steps, both counted from the same numbers the footer
  // prints — so the bar can never contradict the two lines directly beneath it.
  //
  // Step 2 deliberately does *not* read `convertAvailable`. That flag can turn
  // true a poll before the shapes it refers to reach this browser, which ticked
  // Schemas above a footer still reading "0 of 3 schemas back". It stays ticked
  // whether or not anyone opened Review schemas, which was the point of it —
  // settling a shape is what counts, and a file that could not give one up has
  // settled just as surely as one that did.
  const prepareDone = {
    files: progress.total > 0 && progress.uploaded === progress.total,
    schemas: allShapesSettled(batch.schemas, batch.wontConvert, progress.total),
  }

  return (
    <BatchShell
      requestId={requestId}
      current="files"
      done={prepareDone}
      phase={phase}
      footer={
        frozen ? (
          <BatchFooter
            status={
              <p className="text-[12.5px] text-muted-foreground">
                This batch has been converted. Its files and their shapes are fixed.
              </p>
            }
            actions={
              <Button asChild className="h-10 rounded-[10px] text-[13px]">
                <Link href={`/request/${requestId}`}>Go to results</Link>
              </Button>
            }
          />
        ) : (
          <ConvertBar
            convertAvailable={batch.convertAvailable}
            convertBlockedReason={batch.convertBlockedReason}
            converting={converting}
            failure={convertFailure}
            progress={progress}
            stalled={batch.schemasStalled}
            // Every schema in the batch, grouped, on a screen of its own — the
            // footer button is the eye button widened to the whole drop.
            reviewHref={`/request/${requestId}/schemas`}
            onConvert={convert}
          />
        )
      }
    >
      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-6 px-6 py-6">
        {batch.failure && <FailureMessage failure={batch.failure} />}
        {/* Not gated on the poll having succeeded. A failed poll used to be
            answered by a banner above this; without one, gating here leaves a
            screen that says nothing at all. */}
        {batch.files.length === 0 && batch.schemas.length === 0 && (
          <EmptyState
            title="Nothing staged in this browser"
            body="This batch was started somewhere else, or the page was reloaded mid-upload. Anything that reached the server is listed as its shape comes back."
            action={
              <Button asChild variant="outline" className="h-9 rounded-[10px] bg-card">
                <Link href="/">Back to your workspace</Link>
              </Button>
            }
          />
        )}

        {batch.files.length > 0 && (
          // The header already carries the status sentence; saying it twice
          // on one screen makes neither copy worth reading. This line acts
          // on the batch instead, and keeps its weight on the right.
          <FileList
            summary={
              <FileActions
                fileCount={batch.files.length}
                totalBytes={totalBytes}
                failedCount={batch.retryableCount}
                frozen={frozen}
                onRetryAll={batch.retryAllUploads}
                onDiscardFailed={discardFailed}
                onAddFiles={batch.addFiles}
              />
            }
          >
            {batch.files.map((file) => (
              <FileRow
                key={file.localId}
                name={file.name}
                location={file.location}
                size={file.size}
                state={rowState(file)}
                failure={file.failure}
                onRetry={
                  !frozen && file.stage === "failed" && file.file
                    ? () => batch.retryUpload(file.localId)
                    : undefined
                }
                detail={shapeDetail(file, batch.schemas, batch.emptyTables)}
              />
            ))}
          </FileList>
        )}

        <WontConvertPanel
          entries={batch.wontConvert}
          onDiscard={frozen ? undefined : discardFiles}
        />
      </div>
    </BatchShell>
  )
}

const rowState = (file: BatchFile): FileRowState => UPLOAD_STAGE[file.stage]

/**
 * Every table this file gave up, each with its own field count, on the row the
 * file already has — the cards that used to sit under the list said the same
 * thing twice, in more space.
 *
 * Counted table by table rather than summed: field lists differ between the
 * tables in one file, so a total would be a number nothing actually has.
 */
function shapeDetail(
  file: BatchFile,
  schemas: SchemaState[],
  emptyTables: TableFailure[] = [],
): string | undefined {
  const mine = schemas.filter((s) => s.fileId === file.fileId)
  // A worksheet that gave nothing is named here beside the ones that did. It
  // is not an error on the file — the file converts — but leaving it out would
  // show a three-sheet workbook as two sheets and say nothing about the third.
  const empty = emptyTables.filter((t) => t.fileId === file.fileId)
  if (mine.length === 0 && empty.length === 0) return undefined

  return [
    ...mine.map((s) => `${s.tableLabel} · ${formatCount(s.current.length)} fields`),
    ...empty.map((t) => `${t.tableLabel} · nothing usable`),
  ].join(" · ")
}

/**
 * What is left of the two minutes, for a batch this browser converted itself.
 * It slows the polls *after* the first, never the first — that one has real
 * counts to fetch the moment Convert is pressed.
 */
function remainingWait(convertedAt?: string): number {
  if (!convertedAt) return 0
  const since = Date.now() - Date.parse(convertedAt)
  if (Number.isNaN(since)) return 0
  return Math.max(0, RESULT_WARMUP_MS - since)
}

/** The whole drop as one number, by bytes, so one big file cannot stall the bar. */
function uploadFraction(files: BatchFile[]): number {
  const accepted = files.filter((f) => f.stage !== "rejected")
  const total = accepted.reduce((sum, f) => sum + f.size, 0)
  if (total === 0) return 0
  const done = accepted.reduce((sum, f) => {
    if (f.stage === "uploaded") return sum + f.size
    if (f.stage === "uploading") return sum + Math.min(f.size, f.progress?.loaded ?? 0)
    return sum
  }, 0)
  return done / total
}

/* ------------------------------------------------------------------ */
/* Converting — the honest wait, and tables as they land               */
/* ------------------------------------------------------------------ */

function Converting({
  requestId,
  userId,
  convertedAt,
  onPhase,
}: {
  requestId: string
  userId: string | null
  /** Absent for a batch converted somewhere else — then there is nothing to wait out. */
  convertedAt?: string
  onPhase: PhaseWriter
}) {
  // What the last poll said, so opening a table and pressing Back to the batch
  // returns to the screen that was left rather than to a wait for a poll whose
  // answer this browser already has.
  const lastKnown = useMemo(() => readCachedResult(requestId), [requestId])

  // Every file this browser confirmed into the batch, by name. Convert is not
  // gated on shapes (see `convert` in the convert service), so pressing it
  // before they are all back is ordinary — and until a file has a shape the
  // server has no table to report for it. These names are what stands in for
  // the missing rows, which is the difference between a screen with eight
  // files on it and a screen with two.
  const dropped = useMemo(() => readRememberedFiles(requestId), [requestId])

  // And the ones the server answered for with a reason instead of a shape. The
  // result poll says nothing at all about those — no shape means no table to
  // report — so without them they would be mistaken for files still being read
  // and spin a row apiece for the rest of the run.
  //
  // Two sources, because neither is enough on its own. What this browser wrote
  // before the gate covers the files that had already failed inspection; it
  // cannot cover the ones that fail after Convert is pressed, because the
  // schema poll that records them stops the moment this screen replaces
  // Prepare — and converting before every shape is back is exactly the flow
  // these rows exist for. So the shapes are asked for once more here.
  const noted = useMemo(() => readUnreadable(requestId), [requestId])
  const { data: shapes } = useAsync(
    userId ? `${userId}:${requestId}:shapes` : "",
    useCallback(
      (signal: AbortSignal) =>
        userId
          ? api.pollSchemas(userId, requestId, [], signal)
          : Promise.reject(new Error("no session yet")),
      [requestId, userId],
    ),
  )
  const unreadable = useMemo(
    () =>
      new Set([
        ...noted,
        ...(shapes ? partitionFailures(shapes.files).files.map((f) => f.fileId) : []),
      ]),
    [noted, shapes],
  )

  const poll = useResultPolling(requestId, userId, {
    // Recomputed on every render, so the gap after each poll is what is
    // actually left of the window rather than a figure fixed at mount.
    warmupMs: remainingWait(convertedAt),
    // The same reading of a poll the workspace makes when it catches up a card
    // by itself, so a batch watched here and a batch refreshed on the list
    // cannot end up described two different ways.
    onData: (data) => onPhase(requestId, batchPatch(data)),
  })

  const result = poll.data ?? lastKnown
  const finished = result?.status === "COMPLETED" || result?.status === "FAILED"
  const nothingUsable = result ? result.counts.done === 0 && finished : false

  // The files with no table of their own yet. A finished batch has none by
  // definition — whatever the server never answered for, it is not still
  // reading — so the list empties itself rather than stranding a row that
  // spins forever.
  const awaiting: AwaitingFile[] = useMemo(() => {
    if (!result || finished) return []
    const known = new Set(result.files.map((entry) => entry.fileId))
    return dropped
      .filter((file) => !known.has(file.fileId) && !unreadable.has(file.fileId))
      .map((file) => ({ fileId: file.fileId, fileName: file.fileName }))
  }, [dropped, finished, result, unreadable])

  return (
    <BatchShell
      requestId={requestId}
      current="results"
      done={{ files: true, schemas: true }}
      // The rail says "converting" between Schemas and Results until the last
      // file has landed, and then stops saying it.
      phase={finished ? "converted" : "converting"}
      footer={
        <BatchFooter
          status={
            // The one honest line about this batch, in the one place every
            // batch screen puts what it is. It used to sit above the table as
            // well as here in another form — two lines of counts to reconcile
            // for one list — and the rows-so-far tally it replaces is on the
            // workspace card and in Download all already.
            result ? (
              <StatusSentence result={result} awaiting={awaiting.length} className="text-[12.5px]" />
            ) : undefined
          }
          actions={
            result ? (
              <>
                {/* Combining tables is available once every file has
                    finished. Not gated on there being two tables left: a
                    batch that has collapsed into one merged table still
                    needs a way back to the screen that can undo it. */}
                <GatedButton
                  asChild={finished && result.counts.done > 0 ? true : undefined}
                  variant="outline"
                  reason={
                    !finished
                      ? "Available once every file has finished"
                      : result.counts.done === 0
                        ? "No table finished, so there is nothing to combine"
                        : null
                  }
                  hideReason
                  className="bg-card text-[13px]"
                >
                  {finished && result.counts.done > 0 ? (
                    <Link href={`/request/${requestId}/merge`}>Merge</Link>
                  ) : (
                    "Merge"
                  )}
                </GatedButton>
                <DownloadAllDialog requestId={requestId} result={result} />
              </>
            ) : undefined
          }
        />
      }
    >
      <main className="mx-auto flex w-full max-w-[1080px] flex-col gap-6 px-6 py-6">
        {/* One wait, not two: pressing Convert lands here, and the only thing
            still missing is the server's first answer. The rows it brings say
            Waiting with a spinner of their own, so there is no second
            full-screen state between the button and the batch. */}
        {/* Until the first answer lands, whatever the reason. A poll that has
            failed is still a poll that is being retried, and the exhausted
            notice below is what says when the retrying has stopped. */}
        {!result && <ConvertingSkeleton />}

        {/* Out of polls with the batch still running. Saying nothing would
            leave a screen that has quietly stopped telling the truth. */}
        {poll.exhausted && !finished && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-border-subtle bg-card px-4 py-3">
            <p className="text-[12.5px] text-muted-foreground">
              This is taking longer than we keep watching for. Nothing is lost — check again
              whenever you like.
            </p>
            <Button
              variant="outline"
              onClick={poll.refresh}
              className="h-9 rounded-[10px] bg-card text-[13px]"
            >
              Check again
            </Button>
          </div>
        )}

        {result && (
          <>
            {result.status === "PAUSED" && (
              <PausedBanner pausedUntil={result.pausedUntil} allowance={result.allowance} />
            )}

            <PipelineStrip counts={result.counts} detecting={awaiting.length} />

            {nothingUsable ? (
              <EmptyState
                title="Nothing in this batch could be read"
                body="Every file failed, so there are no tables to open. The reasons are on each row below."
              />
            ) : null}

            <TableList requestId={requestId} entries={result.files} awaiting={awaiting} />
          </>
        )}
      </main>
    </BatchShell>
  )
}
