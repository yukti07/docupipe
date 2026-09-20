"use client"

import { ArrowRight } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { use, useEffect, useMemo, useState } from "react"
import { BatchFooter } from "@/components/common/BatchFooter"
import { BatchShell } from "@/components/common/BatchShell"
import { EmptyState } from "@/components/common/EmptyState"
import { GatedButton } from "@/components/common/GatedButton"
import { railPhase } from "@/components/quarry/BatchNav"
import { ConnectionStatus } from "@/components/quarry/ConnectionStatus"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import { PendingSchemaCard } from "@/components/quarry/PendingSchemaCard"
import { SchemaEditor } from "@/components/quarry/SchemaEditor"
import { SchemaGroupCard } from "@/components/quarry/SchemaGroupCard"
import { WontConvertPanel } from "@/components/quarry/WontConvertPanel"
import { Button } from "@/components/ui/button"
import type { Failure } from "@/lib/api/types"
import { formatCount } from "@/lib/format"
import { allShapesSettled, groupByCurrentShape, updateTargetsFor } from "@/lib/schema"
import { ensureSession } from "@/lib/session"
import { useBatch } from "@/state/batch"
import { useWorkspace } from "@/state/workspace"

/** How many nameless "still reading" cards the screen will ever stack up. */
const PENDING_CARDS = 3

/**
 * Review schemas — every shape in the batch, as one decision per shape.
 *
 * One card is one *schema*: every table that came back with the same fields and
 * types, edited together. A batch of forty invoices that all read the same way
 * is therefore one card and one decision, which is the only version of this
 * screen that scales.
 *
 * It opens before the shapes are all in. Whatever has come back is grouped and
 * shown; every file still being read holds a card of its own with its name on
 * it, and is replaced by a real card — or by a line in the panel of files that
 * will not convert — the moment the server answers for it. Nobody waits on the
 * slowest file in the drop to start reviewing the fastest.
 *
 * Grouping is on the shape each table has *now*, so a table already edited has
 * left the group it started in and holds a card of its own — and "update
 * matching tables" here means exactly what it says.
 */
export default function ReviewSchemasPage({ params }: PageProps<"/request/[requestId]/schemas">) {
  const { requestId } = use(params)
  const [userId, setUserId] = useState<string | null>(null)
  const router = useRouter()
  const { batches, updateBatch } = useWorkspace()
  const batch = useBatch(requestId, userId)
  const phase = railPhase(batches.find((b) => b.requestId === requestId)?.phase)
  // Reached from the rail after the gate. The shapes are what the batch was
  // converted against, so they are worth reading and cannot be changed.
  const frozen = phase !== "prepare"

  // Which table the panel is on, and whether it was deliberately shut. Both are
  // needed because "nothing picked yet" and "picked nothing" are different
  // states, and only the first of them opens the first card by itself.
  const [picked, setPicked] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  // Which table the open editor is holding a draft of, so its card can say so.
  const [draftOn, setDraftOn] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)
  const [convertFailure, setConvertFailure] = useState<Failure | null>(null)

  useEffect(() => {
    void ensureSession().then(setUserId)
  }, [])

  const groups = useMemo(() => groupByCurrentShape(batch.schemas), [batch.schemas])

  // A card opens itself: this screen exists to be edited, and an empty panel
  // beside one card is a click spent on nothing.
  //
  // The one it opens is the first table that came back, not `groups[0]` — the
  // groups are sorted by size and re-formed on every edit, so a default read
  // off them slides onto a different table the moment the open one is saved
  // into a group of its own. `batch.schemas` is only ever appended to, so its
  // first entry is the same table for the life of the screen. Derived rather
  // than set from an effect, so schemas arriving cannot re-open a closed panel.
  const openSchemaId = picked ?? (dismissed ? null : (batch.schemas[0]?.schemaId ?? null))
  const open = (schemaId: string) => {
    setPicked(schemaId)
    setDismissed(false)
  }
  const close = () => {
    setPicked(null)
    setDismissed(true)
  }

  // The panel follows the *table*, not the group it was in. Saving a change
  // without applying it moves that table into a group of its own, and the editor
  // has to come with it rather than snapping back to the tables it just left.
  const openGroup = groups.find((g) => g.schemas.some((s) => s.schemaId === openSchemaId)) ?? null
  const openSchema = openGroup?.schemas.find((s) => s.schemaId === openSchemaId) ?? null
  // Wider than the card: every table this schema fits, including the ones
  // short of one of its fields, which no group would ever put beside it.
  const targets = openSchema ? updateTargetsFor(batch.schemas, openSchema) : []

  const tableCount = batch.schemas.length
  const fileCount = new Set(batch.schemas.map((s) => s.fileId)).size

  // Every file the server has now answered for, one way or another: with a
  // shape, with a reason it has none, or with a table that held nothing.
  const settled = useMemo(
    () =>
      new Set([
        ...batch.schemas.map((s) => s.fileId),
        ...batch.wontConvert.map((w) => w.fileId),
        ...batch.emptyTables.map((t) => t.fileId),
      ]),
    [batch.schemas, batch.wontConvert, batch.emptyTables],
  )
  // The rest, by name, in the order they were dropped. A converted batch has
  // nothing outstanding by definition, and a poll that has given up is said on
  // the card rather than by hiding it. A file that never landed is left out
  // alongside a rejected one: there is nothing on the server to answer for it,
  // so a card for it would read "Reading" forever.
  const awaiting = useMemo(
    () =>
      frozen
        ? []
        : batch.files.filter(
            (f) =>
              f.stage !== "rejected" &&
              f.stage !== "failed" &&
              !(f.fileId && settled.has(f.fileId)),
          ),
    [batch.files, frozen, settled],
  )
  // A batch opened in a browser that never held it has no names to put on the
  // cards, only the server's count of what it is still reading.
  const pending = awaiting.length === 0 && !frozen ? batch.pending : 0
  // Only ever a few of them. Without names these cards are the same card
  // repeated, and a shared link to a batch of two hundred should not open on
  // two hundred pulsing skeletons; whatever is over the few is counted in a
  // line beneath them instead.
  const unnamed = Math.min(pending, PENDING_CARDS)
  // Nothing at all yet — not one shape, not one name, not one failure. It lasts
  // as long as the first poll and the read of this browser's own file list.
  const blank =
    tableCount === 0 &&
    awaiting.length === 0 &&
    unnamed === 0 &&
    batch.wontConvert.length === 0 &&
    !batch.schemaPollFailure &&
    !batch.schemasAnswered
  // Whether anything is still on its way. The heading and the empty state read
  // off the same answer, so the screen cannot say it is reading above a card
  // that says nothing came back.
  const reading = awaiting.length > 0 || unnamed > 0 || blank

  async function convert() {
    setConverting(true)
    setConvertFailure(null)
    const result = await batch.convert()
    if (!result.ok) {
      setConverting(false)
      setConvertFailure(result.failure)
      return
    }
    updateBatch(requestId, { phase: "converting", convertedAt: new Date().toISOString() })
    router.push(`/request/${requestId}`)
  }

  return (
    <BatchShell
      requestId={requestId}
      current="schemas"
      done={{
        files: batch.acceptedCount > 0 && batch.uploadedCount === batch.acceptedCount,
        schemas: allShapesSettled(batch.schemas, batch.wontConvert, batch.acceptedCount),
      }}
      phase={phase}
      panelWidth={460}
      panelLabel="Schema"
      // Pressing the page shuts the panel here too, the way it does on
      // Prepare — except while the editor is holding an edit that has not
      // been saved. Throwing that away on a stray press is the one thing
      // this convenience must never do, and `draftOn` is the screen's own
      // record of whether there is anything to throw away.
      closePanelOnPressOutside={draftOn === null}
      onClosePanel={close}
      panel={
        openSchema && openGroup ? (
          <SchemaEditor
            schema={openSchema}
            fileName={openSchema.fileName}
            frozen={frozen}
            title={`Schema of ${formatCount(openGroup.schemas.length)} ${
              openGroup.schemas.length === 1 ? "table" : "tables"
            }`}
            subtitle={`from ${openSchema.fileName} · ${openSchema.tableLabel}`}
            updateTargets={targets}
            onDraftChange={setDraftOn}
            onClose={close}
            onSave={(fields, alsoApplyTo) =>
              batch.saveSchema(openSchema.schemaId, fields, alsoApplyTo)
            }
            className="min-h-0 flex-1"
          />
        ) : null
      }
      footer={
        // The way back to the files is the rail's own Files step, so it is not
        // repeated here. What is left is the one thing this screen leads to.
        <BatchFooter
          banner={convertFailure ? <FailureMessage failure={convertFailure} /> : undefined}
          status={
            tableCount > 0 ? (
              <span className="text-[12.5px] tabular-nums text-subtle-foreground">
                {formatCount(groups.length)} {groups.length === 1 ? "schema" : "schemas"} ·{" "}
                {formatCount(tableCount)} {tableCount === 1 ? "table" : "tables"} ·{" "}
                {formatCount(fileCount)} {fileCount === 1 ? "file" : "files"}
              </span>
            ) : undefined
          }
          actions={
            frozen ? (
              <Button asChild className="h-10 rounded-[10px] text-[13px]">
                <Link href={`/request/${requestId}`}>Go to results</Link>
              </Button>
            ) : (
              <GatedButton
                hideReason
                onClick={convert}
                reason={
                  converting
                    ? "Already converting"
                    : batch.convertAvailable
                      ? null
                      : (batch.convertBlockedReason ?? "Waiting for every file to arrive")
                }
                className="gap-1.5"
              >
                {!converting && <ArrowRight aria-hidden className="size-4" />}
                {converting ? "Converting…" : "Convert"}
              </GatedButton>
            )
          }
        />
      }
    >
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 px-6 py-6">
        <div className="min-w-0">
          {/* Counting nothing is not a heading. Until the first shape is back,
              the screen says what it is doing instead — and once the reading is
              over with nothing to show for it, it says that rather than going
              on claiming to read. */}
          <h1 className="text-[19px] font-semibold tracking-[-0.015em]">
            {groups.length > 0
              ? `${formatCount(groups.length)} ${
                  groups.length === 1 ? "schema" : "schemas"
                } to review`
              : reading
                ? "Reading your schemas"
                : "Nothing to review"}
          </h1>
          {frozen && (
            <p className="mt-1 text-[13px] text-subtle-foreground">
              This batch has been converted. These are the shapes it was read against.
            </p>
          )}
        </div>

        {batch.schemaPollFailure && <ConnectionStatus failure={batch.schemaPollFailure} />}

        {/* Only once nothing is outstanding. A screen with six files still
            being read has not failed to produce a schema; it is mid-sentence. */}
        {groups.length === 0 && !reading && (
          <EmptyState
            title="No schema came back"
            body="Nothing in this batch settled into a table, so there is nothing to review here yet."
            action={
              <Button asChild variant="outline" className="h-9 rounded-[10px] bg-card">
                <Link href={`/request/${requestId}`}>Back to files</Link>
              </Button>
            }
          />
        )}

        <div className="flex flex-col gap-2.5">
          {groups.map((group, index) => (
            <SchemaGroupCard
              key={group.shapeHash}
              group={group}
              defaultOpen={index === 0}
              selected={group.schemas.some((s) => s.schemaId === openSchemaId)}
              unsaved={group.schemas.some((s) => s.schemaId === draftOn)}
              onOpen={open}
            />
          ))}
          {/* Under the real cards, so a shape landing never pushes one that is
              already being read further down the screen. */}
          {awaiting.map((file, index) => (
            <PendingSchemaCard
              key={file.localId}
              fileName={file.name}
              stalled={batch.schemasStalled}
              index={index}
            />
          ))}
          {Array.from({ length: blank ? PENDING_CARDS : unnamed }, (_, index) => (
            <PendingSchemaCard key={`unnamed-${index}`} index={index} />
          ))}
          {/* The ones the cards stand for. A count is all there is to say about
              a file this browser has no name for. */}
          {pending > unnamed && (
            <p className="px-1 text-[12.5px] tabular-nums text-subtle-foreground">
              and {formatCount(pending - unnamed)} more{" "}
              {pending - unnamed === 1 ? "file" : "files"} being read
            </p>
          )}
        </div>

        <WontConvertPanel
          entries={batch.wontConvert}
          onDiscard={
            frozen
              ? undefined
              : async (fileIds) => {
                  // Emptying the batch from here leaves nothing to review, so
                  // the screen goes back to the files rather than to an empty
                  // page of its own.
                  if ((await batch.discardFiles(fileIds)) === 0) router.push("/")
                }
          }
        />
      </div>
    </BatchShell>
  )
}
