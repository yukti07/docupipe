"use client"

import { ArrowRight, ChevronLeft } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { use, useEffect, useMemo, useState } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { GatedButton } from "@/components/common/GatedButton"
import { SplitPane } from "@/components/common/SplitPane"
import { AppHeader } from "@/components/quarry/AppHeader"
import { ConnectionStatus } from "@/components/quarry/ConnectionStatus"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import { SchemaEditor } from "@/components/quarry/SchemaEditor"
import { SchemaGroupCard } from "@/components/quarry/SchemaGroupCard"
import { ReviewSchemasSkeleton } from "@/components/quarry/ReviewSchemasSkeleton"
import { WontConvertPanel } from "@/components/quarry/WontConvertPanel"
import { Button } from "@/components/ui/button"
import type { Failure } from "@/lib/api/types"
import { formatCount } from "@/lib/format"
import { groupByCurrentShape, updateTargetsFor } from "@/lib/schema"
import { ensureSession } from "@/lib/session"
import { useBatch } from "@/state/batch"
import { useWorkspace } from "@/state/workspace"

/**
 * Review schemas — the same job as a row's eye, over the whole batch at once.
 *
 * The eye opens one *file*. This opens one *schema*: every table that came back
 * with the same fields and types is a single card, and editing that card edits
 * the lot. A batch of forty invoices that all read the same way is therefore one
 * card and one decision, which is the only version of this screen that scales.
 *
 * Grouping is on the shape each table has *now*, so a table already edited from
 * its own file's row has left the group it started in and holds a card of its
 * own — and "update matching tables" here means exactly what it says.
 */
export default function ReviewSchemasPage({ params }: PageProps<"/request/[requestId]/schemas">) {
  const { requestId } = use(params)
  const [userId, setUserId] = useState<string | null>(null)
  const router = useRouter()
  const { updateBatch } = useWorkspace()
  const batch = useBatch(requestId, userId)

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
  // Nothing to show and something still coming: before the first poll answers,
  // or while it says more files are being read. A failure ends the wait too —
  // it has an answer of its own, and it belongs on the screen rather than
  // under a skeleton that would now never resolve.
  const waiting =
    tableCount === 0 &&
    !batch.schemaPollFailure &&
    (!batch.schemasAnswered || batch.pending > 0)

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
    <>
      <AppHeader userId={userId}>
        <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
          <Link
            href={`/request/${requestId}`}
            className="shrink-0 text-muted-foreground hover:text-foreground hover:underline"
          >
            Prepare
          </Link>
          <span aria-hidden className="text-border">
            /
          </span>
          <span className="truncate font-medium">Review schemas</span>
        </div>
      </AppHeader>

      {waiting ? (
        // The same skeleton the route showed on the way in, so arriving here
        // changes nothing on screen until there is something true to put on it.
        <ReviewSchemasSkeleton />
      ) : (
      <SplitPane
        className="flex-1"
        panelWidth={460}
        panelLabel="Schema"
        // Pressing the list shuts the panel here too, the way it does on
        // Prepare — except while the editor is holding an edit that has not
        // been saved. Throwing that away on a stray press is the one thing
        // this convenience must never do, and `draftOn` is the screen's own
        // record of whether there is anything to throw away.
        closeOnPressOutside={draftOn === null}
        onClose={close}
        panel={
          openSchema && openGroup ? (
            <SchemaEditor
              schema={openSchema}
              fileName={openSchema.fileName}
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
        list={
          <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 px-6 py-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-[19px] font-semibold tracking-[-0.015em]">
                  {formatCount(groups.length)}{" "}
                  {groups.length === 1 ? "schema" : "schemas"} to review
                </h1>
                <p className="mt-1 text-[13px] tabular-nums text-subtle-foreground">
                  {formatCount(tableCount)} {tableCount === 1 ? "table" : "tables"} ·{" "}
                  {formatCount(fileCount)} {fileCount === 1 ? "file" : "files"}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  asChild
                  variant="outline"
                  className="h-10 gap-1.5 rounded-[10px] bg-card text-[13px]"
                >
                  <Link href={`/request/${requestId}`}>
                    <ChevronLeft aria-hidden className="size-4" />
                    Back to files
                  </Link>
                </Button>
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
                  {converting
                    ? "Converting…"
                    : `Convert${tableCount > 0 ? ` ${formatCount(tableCount)} ${tableCount === 1 ? "table" : "tables"}` : ""}`}
                </GatedButton>
              </div>
            </div>

            {convertFailure && <FailureMessage failure={convertFailure} />}
            {batch.schemaPollFailure && <ConnectionStatus failure={batch.schemaPollFailure} />}

            {groups.length === 0 && (
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

            {groups.length > 0 && (
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
              </div>
            )}

            <WontConvertPanel
              entries={batch.wontConvert}
              onDiscard={async (fileIds) => {
                // Emptying the batch from here leaves nothing to review, so
                // the screen goes back to the files rather than to an empty
                // page of its own.
                if ((await batch.discardFiles(fileIds)) === 0) router.push("/")
              }}
            />
          </div>
        }
      />
      )}
    </>
  )
}
