"use client"

import Link from "next/link"
import { use, useEffect, useState } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { GatedButton } from "@/components/common/GatedButton"
import { LoadingState } from "@/components/common/LoadingState"
import { SplitPane } from "@/components/common/SplitPane"
import { AppHeader } from "@/components/quarry/AppHeader"
import { ConnectionStatus } from "@/components/quarry/ConnectionStatus"
import { ConvertBar } from "@/components/quarry/ConvertBar"
import { DownloadAllDialog } from "@/components/quarry/DownloadAllDialog"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import { FileList } from "@/components/quarry/FileList"
import { FileRow, type FileRowState } from "@/components/quarry/FileRow"
import { PausedBanner } from "@/components/quarry/PausedBanner"
import { PipelineStrip } from "@/components/quarry/PipelineStrip"
import { SchemaEditor } from "@/components/quarry/SchemaEditor"
import { SchemaGroupList } from "@/components/quarry/SchemaGroupList"
import { StatusSentence, shapesSentence } from "@/components/quarry/StatusSentence"
import { TableList } from "@/components/quarry/TableList"
import { WontConvertPanel } from "@/components/quarry/WontConvertPanel"
import { Button } from "@/components/ui/button"
import type { Failure } from "@/lib/api/types"
import { formatCount } from "@/lib/format"
import { applyToAllTargets, type SchemaState } from "@/lib/schema"
import { ensureSession } from "@/lib/session"
import { useBatch, type BatchFile } from "@/state/batch"
import { useConversionProbe, useResultPolling } from "@/state/result"
import { useWorkspace } from "@/state/workspace"

const UPLOAD_STAGE: Record<BatchFile["stage"], FileRowState> = {
  staged: "staged",
  checking: "checking",
  rejected: "rejected",
  uploading: "uploading",
  uploaded: "uploaded",
  failed: "failed",
}

export default function BatchPage({ params }: PageProps<"/b/[requestId]">) {
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
  const probe = useConversionProbe(requestId, userId)
  const converting = probe === "started" || noted

  useEffect(() => {
    if (probe === "started" && !noted) updateBatch(requestId, { phase: "converting" })
  }, [noted, probe, requestId, updateBatch])

  return converting ? (
    <Converting requestId={requestId} userId={userId} onPhase={updateBatch} />
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
  const [openSchemaId, setOpenSchemaId] = useState<string | null>(null)
  const [showAllSchemas, setShowAllSchemas] = useState(false)
  const [converting, setConverting] = useState(false)
  const [convertFailure, setConvertFailure] = useState<Failure | null>(null)

  const open = batch.schemas.find((s) => s.schemaId === openSchemaId) ?? null
  const uploadDone = batch.files.length > 0 && !batch.uploading
  const showSchemas = showAllSchemas || (uploadDone && batch.schemas.length > 0)

  async function convert() {
    setConverting(true)
    setConvertFailure(null)
    const result = await batch.convert()
    if (!result.ok) {
      setConverting(false)
      setConvertFailure(result.failure)
      return
    }
    onPhase(requestId, { phase: "converting" })
  }

  const rejectedCount = batch.files.filter((file) => file.stage === "rejected").length

  const summary = shapesSentence({
    uploaded: batch.uploadedCount,
    total: batch.acceptedCount,
    schemas: batch.schemas.length,
    failed: batch.wontConvert.length,
  })

  return (
    <>
      <AppHeader userId={userId}>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium">Prepare</p>
          {/* Shapes landing and uploads finishing are announced, never focused. */}
          <p
            aria-live="polite"
            className="truncate text-[12px] tabular-nums text-muted-foreground"
          >
            {summary}
          </p>
        </div>
      </AppHeader>

      <SplitPane
        className="flex-1"
        panelWidth={460}
        panelLabel="Schema"
        onClose={() => setOpenSchemaId(null)}
        panel={
          open ? (
            <SchemaEditor
              schema={open}
              fileName={open.fileName}
              applyTargets={applyToAllTargets(batch.schemas, open)}
              onClose={() => setOpenSchemaId(null)}
              onSave={(fields, alsoApplyTo) =>
                batch.saveSchema(open.schemaId, fields, alsoApplyTo)
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
              // on one screen makes neither copy worth reading.
              <FileList
                summary={
                  <span>
                    {formatCount(batch.files.length)}{" "}
                    {batch.files.length === 1 ? "file" : "files"} dropped
                    {rejectedCount > 0 ? ` · ${formatCount(rejectedCount)} rejected` : ""}
                  </span>
                }
              >
                {batch.files.map((file) => (
                  <FileRow
                    key={file.localId}
                    name={file.name}
                    location={file.location}
                    size={file.size}
                    state={rowState(file, batch.schemas, batch.wontConvert)}
                    progress={file.progress}
                    failure={file.failure}
                    onRetry={file.stage === "failed" ? () => batch.retryUpload(file.localId) : undefined}
                    trailing={
                      <PreviewEdit
                        file={file}
                        state={rowState(file, batch.schemas, batch.wontConvert)}
                        schemas={batch.schemas}
                        onOpen={setOpenSchemaId}
                      />
                    }
                  />
                ))}
              </FileList>
            )}

            {batch.uploading && batch.files.length > 0 && (
              <LoadingState
                label="Uploading your files"
                value={batch.uploadedCount}
                of={batch.acceptedCount}
              />
            )}

            {showSchemas && batch.schemas.length > 0 && (
              <section>
                <h2 className="mb-3 text-[13px] font-medium text-subtle-foreground">
                  {formatCount(batch.schemas.length)} schemas back
                </h2>
                <SchemaGroupList
                  schemas={batch.schemas}
                  openSchemaId={openSchemaId}
                  onOpen={(schema: SchemaState) => setOpenSchemaId(schema.schemaId)}
                />
              </section>
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
        onReviewSchemas={() => setShowAllSchemas(true)}
        onConvert={convert}
      />
    </>
  )
}

/** Ten states, one row: what this file is doing right now. */
function rowState(
  file: BatchFile,
  schemas: SchemaState[],
  wontConvert: { fileId: string }[],
): FileRowState {
  if (file.stage !== "uploaded") return UPLOAD_STAGE[file.stage]
  if (file.fileId && schemas.some((s) => s.fileId === file.fileId)) return "shape-ready"
  if (file.fileId && wontConvert.some((w) => w.fileId === file.fileId)) return "no-shape"
  return "reading-shape"
}

/** Why this file has no shape to open — the row's own state, not a guess. */
const NO_SCHEMA_REASON: Partial<Record<FileRowState, string>> = {
  rejected: "This file was rejected",
  failed: "This file didn't finish uploading",
  "no-shape": "No table was found in this file",
  unreadable: "This file couldn't be read",
}

function PreviewEdit({
  file,
  state,
  schemas,
  onOpen,
}: {
  file: BatchFile
  state: FileRowState
  schemas: SchemaState[]
  onOpen: (schemaId: string) => void
}) {
  const mine = schemas.filter((s) => s.fileId === file.fileId)

  // Present from the first frame and disabled until the shape lands: an empty
  // space says nothing, a disabled button says something is coming.
  if (mine.length === 0) {
    return (
      <GatedButton
        variant="outline"
        reason={NO_SCHEMA_REASON[state] ?? "Still reading this file"}
        reasonClassName="hidden sm:inline"
        className="h-8 rounded-lg bg-card text-[12.5px]"
      >
        Preview / Edit
      </GatedButton>
    )
  }

  // A file that held three tables offers three, each labelled by where it came from.
  if (mine.length === 1) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => onOpen(mine[0].schemaId)}
        className="h-8 rounded-lg bg-card text-[12.5px]"
      >
        Preview / Edit
      </Button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {mine.map((schema) => (
        <Button
          key={schema.schemaId}
          variant="outline"
          size="sm"
          onClick={() => onOpen(schema.schemaId)}
          className="h-8 rounded-lg bg-card text-[12px]"
        >
          {schema.tableLabel}
        </Button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Converting — the honest wait, and tables as they land               */
/* ------------------------------------------------------------------ */

function Converting({
  requestId,
  userId,
  onPhase,
}: {
  requestId: string
  userId: string | null
  onPhase: PhaseWriter
}) {
  const poll = useResultPolling(requestId, userId, {
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

  const result = poll.data
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
        {!poll.settled && <LoadingState label="Waking up" />}
        {poll.failure && <ConnectionStatus failure={poll.failure} />}

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
                        <Link href={`/b/${requestId}/merge`}>Merge</Link>
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
