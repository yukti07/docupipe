"use client"

import { Check, X } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import { LoadingState } from "@/components/common/LoadingState"
import { AddFieldControl } from "@/components/quarry/AddFieldControl"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import { SchemaFieldRow } from "@/components/quarry/SchemaFieldRow"
import { UpdateOthersControl } from "@/components/quarry/UpdateOthersControl"
import { UpdateTargetsPicker } from "@/components/quarry/UpdateTargetsPicker"
import { GatedButton } from "@/components/common/GatedButton"
import { Button } from "@/components/ui/button"
import { formatCount } from "@/lib/format"
import type { Failure, FieldType } from "@/lib/api/types"
import {
  addField,
  changeFieldType,
  shapeHash,
  type SchemaState,
  type UpdateTarget,
} from "@/lib/schema"
import { cn } from "@/lib/utils"

/** Which of the two writes is in flight, so each button speaks only for itself. */
type Commit = "save" | "update"

type EditState = {
  schemaId: string | null
  draft: SchemaState["current"]
  /** The picker is up, in place of the fields. */
  picking: boolean
  /** What the last write did, and what it wrote. */
  done: { kind: Commit; others: number; fields: SchemaState["current"] } | null
  failure: Failure | null
}

export type SchemaEditorProps = {
  /** null while this file's shape is still being read. */
  schema: SchemaState | null
  fileName: string
  /** Overrides the heading — the review screen heads one editor for a whole group. */
  title?: ReactNode
  subtitle?: ReactNode
  /** Reading, or settled without a shape. */
  reading?: boolean
  noShape?: Failure
  /** The other tables this schema can be written onto, with how far each one is from it. */
  updateTargets?: UpdateTarget[]
  /** Told which schema is holding a draft, so the screen behind can say so too. */
  onDraftChange?: (schemaId: string | null) => void
  onSave: (
    fields: SchemaState["current"],
    alsoApplyTo: string[],
  ) => Promise<{ ok: true } | { ok: false; failure: Failure }>
  onClose?: () => void
  frozen?: boolean
  className?: string
}

export function SchemaEditor({
  schema,
  fileName,
  title,
  subtitle,
  reading,
  noShape,
  updateTargets = [],
  onDraftChange,
  onSave,
  onClose,
  frozen,
  className,
}: SchemaEditorProps) {
  // All of the editing state is keyed by the schema it belongs to, so opening a
  // different one shows that one's fields without an effect resetting anything
  // — and a re-render of the same one never throws away an edit in progress.
  const [edit, setEdit] = useState<EditState | null>(null)
  const [committing, setCommitting] = useState<Commit | null>(null)

  const schemaId = schema?.schemaId ?? null
  const current: EditState =
    edit?.schemaId === schemaId
      ? edit
      : { schemaId, draft: schema?.current ?? [], picking: false, done: null, failure: null }

  const { draft, picking, done, failure } = current
  const busy = committing !== null
  const patch = (next: Partial<EditState>) => setEdit({ ...current, ...next })
  const setDraft = (update: (fields: SchemaState["current"]) => SchemaState["current"]) =>
    patch({ draft: update(draft), done: null })

  // What is on the server now — which after a write is what we just sent, whether
  // or not the screen above has caught up with it yet.
  const committed = done?.fields ?? schema?.current ?? []
  const dirty = schema ? shapeHash(draft) !== shapeHash(committed) : false

  // This table is on the server exactly as it is on screen, and was put there
  // from here — which is the only state in which Save has nothing left to say.
  const saved = done?.kind === "save" && !dirty
  const note = schema ? footerNote(schema, current, dirty) : null

  // The card this editor was opened from says "Unsaved changes" while there is
  // one. Reported from an effect rather than during render, and cleared on the
  // way out, so closing the panel or moving to another table takes it with it.
  useEffect(() => {
    if (!dirty || !schemaId) return
    onDraftChange?.(schemaId)
    return () => onDraftChange?.(null)
  }, [dirty, schemaId, onDraftChange])

  /**
   * One write with two target lists. Save sends this table alone; an update
   * sends it and whichever others were chosen. The second is shut while the
   * first is outstanding, because pushing a shape nobody has committed to onto
   * files nobody is looking at is the one mistake this panel can make at scale.
   */
  async function commit(kind: Commit, targetIds: string[] = []) {
    if (!schema) return
    setCommitting(kind)
    patch({ failure: null })
    const result = await onSave(draft, targetIds)
    setCommitting(null)
    if (result.ok) {
      patch({
        failure: null,
        picking: false,
        done: { kind, others: targetIds.length, fields: draft },
      })
      return
    }
    // The edit — and the picker's selection — stays on screen. Losing either
    // would be worse than the failure.
    patch({ failure: result.failure })
  }

  if (schema && picking) {
    return (
      <div className={cn("flex min-h-0 flex-col", className)}>
        <UpdateTargetsPicker
          sourceName={schema.fileName}
          version={schema.version}
          targets={updateTargets}
          updating={committing === "update"}
          failure={failure}
          onCancel={() => patch({ picking: false, failure: null })}
          onConfirm={(ids) => void commit("update", ids)}
          className="min-h-0 flex-1"
        />
      </div>
    )
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="min-w-0">
          {/* A file name is mono because it is a literal string on disk. A
              heading the screen wrote — "Schema of 38 tables" — is prose. */}
          <p className={cn("truncate text-[13px] font-medium", !title && "font-mono")}>
            {title ?? fileName}
          </p>
          {(subtitle ?? schema) && (
            <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
              {subtitle ?? `${schema!.tableLabel} · version ${schema!.version}`}
            </p>
          )}
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close the schema panel"
            onClick={onClose}
            className="size-8 shrink-0 rounded-lg"
          >
            <X aria-hidden className="size-4" />
          </Button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        {reading && <LoadingState label={`Reading ${fileName}`} />}

        {noShape && (
          <div className="flex flex-col gap-3">
            <FailureMessage failure={noShape} />
            <p className="text-[12.5px] text-muted-foreground">
              You can add the fields yourself below, or leave this file out and convert the rest.
            </p>
          </div>
        )}

        {schema && (
          <div className="overflow-hidden rounded-xl border border-border-subtle bg-card">
            {draft.map((field) => (
              <SchemaFieldRow
                key={field.key}
                field={field}
                originalType={schema.original.find((f) => f.key === field.key)?.type}
                disabled={frozen || busy}
                onChangeType={(type) => setDraft((fields) => changeFieldType(fields, field.key, type))}
              />
            ))}
          </div>
        )}

        {/* Under the columns, where the next one would go — not down in the
            footer among the controls that commit the whole thing. */}
        {!frozen && (schema || noShape) && (
          <AddFieldControl
            fields={draft}
            disabled={busy}
            onAdd={(name, type: FieldType) => setDraft((fields) => addField(fields, name, type))}
          />
        )}
      </div>

      {!frozen && (schema || noShape) && (
        <footer className="flex flex-col gap-2.5 border-t border-border-subtle px-4 py-3">
          {failure && <FailureMessage failure={failure} />}

          {schema && (
            <>
              <div className="flex items-center gap-2">
                <UpdateOthersControl
                  targets={updateTargets}
                  updating={committing === "update"}
                  // An unsaved edit goes to this table first.
                  disabled={dirty || busy}
                  onSelect={() => patch({ picking: true })}
                  onUpdateAll={() =>
                    void commit("update", updateTargets.map((t) => t.schema.schemaId))
                  }
                  className="flex-1"
                />
                <GatedButton
                  onClick={() => void commit("save")}
                  hideReason
                  // `busy` gates it shut even while committing "update" — the
                  // label only changes to "Saving…" for its own kind, but
                  // either write in flight is a reason a second click must not
                  // start a concurrent one racing it.
                  reason={busy ? "A write is already in progress" : dirty ? null : "Nothing changed yet"}
                  variant={saved ? "outline" : "default"}
                  className={cn(
                    "h-9 shrink-0 gap-1.5 rounded-[10px] text-[13px]",
                    saved && "bg-card",
                  )}
                >
                  {saved && <Check aria-hidden className="size-3.5" />}
                  {committing === "save" ? "Saving…" : saved ? "Saved" : "Save"}
                </GatedButton>
              </div>

              {/* One line, and only when it has something to say: why the wide
                  write is shut, or what the last one actually reached. */}
              {note && (
                <p className="text-[12px] text-subtle-foreground" role="status">
                  {note}
                </p>
              )}
            </>
          )}
        </footer>
      )}

      {frozen && (
        <footer className="border-t border-border-subtle px-4 py-3 text-[12px] text-muted-foreground">
          Schemas freeze at Convert. Nothing on this screen can be edited now.
        </footer>
      )}
    </div>
  )
}

function footerNote(
  schema: SchemaState,
  { done }: EditState,
  dirty: boolean,
): string | null {
  if (dirty) return "Save this schema before pushing it anywhere else."
  if (done?.kind === "save") return `Version ${schema.version} committed for this table.`
  if (done?.kind === "update") {
    return `Updated ${formatCount(done.others)} other ${done.others === 1 ? "table" : "tables"}.`
  }
  return null
}
