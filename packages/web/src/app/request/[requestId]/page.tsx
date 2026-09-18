"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { use, useEffect, useMemo, useState } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { GatedButton } from "@/components/common/GatedButton"
import { SplitPane } from "@/components/common/SplitPane"
import { AppHeader } from "@/components/quarry/AppHeader"
import { ConnectionStatus } from "@/components/quarry/ConnectionStatus"
import { ConvertBar } from "@/components/quarry/ConvertBar"
import { ConvertingSkeleton } from "@/components/quarry/ConvertingSkeleton"
import { DownloadAllDialog } from "@/components/quarry/DownloadAllDialog"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import { FileActions } from "@/components/quarry/FileActions"
import { FileList } from "@/components/quarry/FileList"
import { FileRow, type FileRowState } from "@/components/quarry/FileRow"
import { FileSchemaPanel } from "@/components/quarry/FileSchemaPanel"
import { PausedBanner } from "@/components/quarry/PausedBanner"
import { PipelineStrip } from "@/components/quarry/PipelineStrip"
import { SchemaEditButton, type SchemaEditState } from "@/components/quarry/SchemaEditButton"
import { StatusSentence } from "@/components/quarry/StatusSentence"
import { TableList } from "@/components/quarry/TableList"
import { WontConvertPanel } from "@/components/quarry/WontConvertPanel"
import { Button } from "@/components/ui/button"
import type { Failure } from "@/lib/api/types"
import { forgetCached, readCachedResult } from "@/lib/cache"
import { formatCount } from "@/lib/format"
import { updateTargetsFor, type SchemaState } from "@/lib/schema"
import { ensureSession } from "@/lib/session"
import { useBatch, type BatchFile } from "@/state/batch"
import { forgetFiles } from "@/state/batchFiles"
import {
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

export default function BatchPage({ params }: PageProps<"/request/[requestId]">) {
  const { requestId } = use(params)
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

  return converting ? (
    <Converting
      requestId={requestId}
      userId={userId}
      convertedAt={batch?.convertedAt}
      onPhase={updateBatch}
    />
  ) : (
    <Prepare requestId={requestId} userId={userId} onPhase={updateBatch} />
  )
}

type PhaseWriter = ReturnType<typeof useWorkspace>["updateBatch"]

/* ------------------------------------------------------------------ */
/* Prepare — files up, shapes back, the gate                           */
/* ------------------------------------------------------------------ */

function Prepare({
  requestId,
  userId,
  onPhase,
}: {
  requestId: string
  userId: string | null
  onPhase: PhaseWriter
}) {
  const batch = useBatch(requestId, userId)
  const router = useRouter()
  const { removeBatch } = useWorkspace()
  // Keyed by file, never by table: one row opens one panel, whatever it holds.
  const [openFileId, setOpenFileId] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)
  const [convertFailure, setConvertFailure] = useState<Failure | null>(null)

  const openFile = batch.files.find((f) => f.fileId && f.fileId === openFileId) ?? null
  const openSchemas = batch.schemas.filter((s) => s.fileId === openFileId)

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

  return (
    <>
      <AppHeader userId={userId}>
        {/* The counts live on the footer now, beside the bar they belong to. */}
        <p className="truncate text-[13px] font-medium">Prepare</p>
      </AppHeader>

      <SplitPane
        className="flex-1"
        panelWidth={460}
        panelLabel="Schema"
        closeOnPressOutside
        onClose={() => setOpenFileId(null)}
        panel={
          openFileId && openSchemas.length > 0 ? (
            <FileSchemaPanel
              fileName={openFile?.name ?? openSchemas[0].fileName}
              schemas={openSchemas}
              targetsFor={(schema) => updateTargetsFor(batch.schemas, schema)}
              onClose={() => setOpenFileId(null)}
              onSave={(schemaId, fields, alsoApplyTo) =>
                batch.saveSchema(schemaId, fields, alsoApplyTo)
              }
            />
          ) : null
        }
        list={
          <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-6 px-6 py-6">
            {batch.failure && <FailureMessage failure={batch.failure} />}
            {batch.schemaPollFailure && (
              <ConnectionStatus failure={batch.schemaPollFailure} />
            )}

            {batch.files.length === 0 && batch.schemas.length === 0 && !batch.schemaPollFailure && (
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
                      file.stage === "failed" && file.file
                        ? () => batch.retryUpload(file.localId)
                        : undefined
                    }
                    detail={shapeDetail(file, batch.schemas)}
                    trailing={
                      <FileEditButton
                        file={file}
                        schemas={batch.schemas}
                        wontConvert={batch.wontConvert}
                        stalled={batch.schemasStalled}
                        onOpen={setOpenFileId}
                      />
                    }
                  />
                ))}
              </FileList>
            )}

            <WontConvertPanel entries={batch.wontConvert} />
          </div>
        }
      />

      <ConvertBar
        readySchemaCount={batch.schemas.length}
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
    </>
  )
}

/** The row says what the upload is doing. The button says what the schema is doing. */
const rowState = (file: BatchFile): FileRowState => UPLOAD_STAGE[file.stage]

/** What this file's schema is doing, which is the only thing the button can mean. */
function editState(
  file: BatchFile,
  schemas: SchemaState[],
  wontConvert: { fileId: string }[],
  stalled?: boolean,
): SchemaEditState {
  if (file.fileId && schemas.some((s) => s.fileId === file.fileId)) return "ready"
  if (file.stage !== "uploaded") return "uploading"
  if (file.fileId && wontConvert.some((w) => w.fileId === file.fileId)) return "none"
  return stalled ? "stalled" : "loading"
}

/**
 * Every table this file gave up, each with its own field count, on the row the
 * file already has — the cards that used to sit under the list said the same
 * thing twice, in more space.
 *
 * Counted table by table rather than summed: field lists differ between the
 * tables in one file, so a total would be a number nothing actually has.
 */
function shapeDetail(file: BatchFile, schemas: SchemaState[]): string | undefined {
  const mine = schemas.filter((s) => s.fileId === file.fileId)
  if (mine.length === 0) return undefined
  return mine
    .map((s) => `${s.tableLabel} · ${formatCount(s.current.length)} fields`)
    .join(" · ")
}

/**
 * One button per row. A file that did not upload has Retry instead and no
 * button at all — a dead control beside a live one only crowds the live one out.
 */
function FileEditButton({
  file,
  schemas,
  wontConvert,
  stalled,
  onOpen,
}: {
  file: BatchFile
  schemas: SchemaState[]
  wontConvert: { fileId: string }[]
  /** The poll gave up; this file's schema is not on its way any more. */
  stalled?: boolean
  onOpen: (fileId: string) => void
}) {
  if (file.stage === "failed" || file.stage === "rejected") return null

  const mine = schemas.filter((s) => s.fileId === file.fileId)

  return (
    <SchemaEditButton
      state={editState(file, schemas, wontConvert, stalled)}
      tableCount={mine.length}
      onOpen={() => file.fileId && onOpen(file.fileId)}
    />
  )
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

  const poll = useResultPolling(requestId, userId, {
    // Recomputed on every render, so the gap after each poll is what is
    // actually left of the window rather than a figure fixed at mount.
    warmupMs: remainingWait(convertedAt),
    onData: (data) => {
      const toCheck = data.files.reduce((sum, f) => sum + (f.toCheckCount ?? 0), 0)
      onPhase(requestId, {
        // Counted from the server's own list, so a batch this browser has just
        // learned about gets a card that reads true.
        fileCount: data.files.length,
        phase:
          data.status === "PAUSED"
            ? "paused"
            : data.status === "COMPLETED"
              ? "done"
              : data.status === "FAILED"
                ? "failed"
                : "converting",
        summary: {
          tables: data.counts.done,
          rows: data.rowsSoFar,
          failed: data.counts.failed,
          toCheck,
          etaSeconds: data.estimatedSecondsRemaining,
          pausedUntil: data.pausedUntil,
        },
      })
    },
  })

  const result = poll.data ?? lastKnown
  const finished = result?.status === "COMPLETED" || result?.status === "FAILED"
  const nothingUsable = result ? result.counts.done === 0 && finished : false

  return (
    <>
      <AppHeader userId={userId} allowance={result?.allowance}>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium">
            {finished ? "Finished" : result?.status === "PAUSED" ? "Paused" : "Converting"}
          </p>
          {result && <StatusSentence result={result} className="truncate" />}
        </div>
      </AppHeader>

      <main className="mx-auto flex w-full max-w-[1080px] flex-1 flex-col gap-6 px-6 py-6">
        {/* One wait, not two: pressing Convert lands here, and the only thing
            still missing is the server's first answer. The rows it brings say
            Waiting with a spinner of their own, so there is no second
            full-screen state between the button and the batch. */}
        {!result && !poll.failure && <ConvertingSkeleton />}
        {poll.failure && <ConnectionStatus failure={poll.failure} />}

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

            <PipelineStrip counts={result.counts} />

            {nothingUsable ? (
              <EmptyState
                title="Nothing in this batch could be read"
                body="Every file failed, so there are no tables to open. The reasons are on each row below."
              />
            ) : null}

            <TableList
              requestId={requestId}
              entries={result.files}
              summary={
                <>
                  <span>
                    {formatCount(result.rowsSoFar)} rows so far across{" "}
                    {formatCount(result.counts.done)} tables
                  </span>
                  <span className="flex items-center gap-2">
                    {/* Combining tables is available once every file has finished. */}
                    <GatedButton
                      asChild={finished && result.counts.done > 1 ? true : undefined}
                      variant="outline"
                      reason={
                        !finished
                          ? "Available once every file has finished"
                          : result.counts.done < 2
                            ? "There's only one table to combine"
                            : null
                      }
                      reasonClassName="hidden sm:inline"
                      className="h-8 rounded-lg bg-card text-[12.5px]"
                    >
                      {finished && result.counts.done > 1 ? (
                        <Link href={`/request/${requestId}/merge`}>Merge</Link>
                      ) : (
                        "Merge"
                      )}
                    </GatedButton>
                    <DownloadAllDialog requestId={requestId} result={result} />
                  </span>
                </>
              }
            />
          </>
        )}
      </main>
    </>
  )
}
