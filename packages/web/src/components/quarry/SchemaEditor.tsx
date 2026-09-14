"use client"

import { X } from "lucide-react"
import { useState } from "react"
import { LoadingState } from "@/components/common/LoadingState"
import { AddFieldControl } from "@/components/quarry/AddFieldControl"
import { ApplyToAllControl } from "@/components/quarry/ApplyToAllControl"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import { SchemaFieldRow } from "@/components/quarry/SchemaFieldRow"
import { GatedButton } from "@/components/common/GatedButton"
import { Button } from "@/components/ui/button"
import type { Failure, FieldType } from "@/lib/api/types"
import { addField, changeFieldType, shapeHash, type SchemaState } from "@/lib/schema"
import { cn } from "@/lib/utils"

type EditState = {
  schemaId: string | null
  draft: SchemaState["current"]
  applyToAll: boolean
  saved: { count: number; fields: SchemaState["current"] } | null
  failure: Failure | null
}

export type SchemaEditorProps = {
  /** null while this file's shape is still being read. */
  schema: SchemaState | null
  fileName: string
  /** Reading, or settled without a shape. */
  reading?: boolean
  noShape?: Failure
  /** Other schemas whose original shape matched this one's. */
  applyTargets?: SchemaState[]
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
  reading,
  noShape,
  applyTargets = [],
  onSave,
  onClose,
  frozen,
  className,
}: SchemaEditorProps) {
  // All of the editing state is keyed by the schema it belongs to, so opening a
  // different one shows that one's fields without an effect resetting anything
  // — and a re-render of the same one never throws away an edit in progress.
  const [edit, setEdit] = useState<EditState | null>(null)
  const [saving, setSaving] = useState(false)

  const schemaId = schema?.schemaId ?? null
  const current: EditState =
    edit?.schemaId === schemaId
      ? edit
      : { schemaId, draft: schema?.current ?? [], applyToAll: false, saved: null, failure: null }

  const { draft, applyToAll, saved, failure } = current
  const patch = (next: Partial<EditState>) => setEdit({ ...current, ...next })
  const setDraft = (update: (fields: SchemaState["current"]) => SchemaState["current"]) =>
    patch({ draft: update(draft) })

  // What is on the server now — which after a save is what we just sent, whether
  // or not the screen above has caught up with it yet.
  const committed = saved?.fields ?? schema?.current ?? []
  const dirty = schema ? shapeHash(draft) !== shapeHash(committed) : false

  async function save() {
    if (!schema) return
    setSaving(true)
    patch({ failure: null })
    const targets = applyToAll ? applyTargets.map((t) => t.schemaId) : []
    const result = await onSave(draft, targets)
    setSaving(false)
    if (result.ok) {
      patch({ failure: null, saved: { count: 1 + targets.length, fields: draft } })
      return
    }
    // The edit stays on screen. Losing it would be worse than the failure.
    patch({ failure: result.failure })
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-[13px] font-medium">{fileName}</p>
          {schema && (
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              {schema.tableLabel} · version {schema.version}
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

      <div className="min-h-0 flex-1 overflow-auto p-4">
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
                disabled={frozen || saving}
                onChangeType={(type) => setDraft((fields) => changeFieldType(fields, field.key, type))}
              />
            ))}
          </div>
        )}
      </div>

      {!frozen && (schema || noShape) && (
        <footer className="flex flex-col gap-3 border-t border-border-subtle px-4 py-3">
          <AddFieldControl
            fields={draft}
            disabled={saving}
            onAdd={(name, type: FieldType) => setDraft((fields) => addField(fields, name, type))}
          />

          {schema && (
            <ApplyToAllControl
              targets={applyTargets}
              checked={applyToAll}
              onCheckedChange={(next) => patch({ applyToAll: next })}
            />
          )}

          {failure && <FailureMessage failure={failure} />}

          {saved !== null && !dirty && (
            <p className="text-[12px] text-subtle-foreground" role="status">
              Saved{saved.count > 1 ? ` to ${saved.count} files` : ""}.
            </p>
          )}

          <GatedButton
            onClick={save}
            reason={
              saving || !schema || dirty
                ? null
                : "Nothing changed yet — change a type or add a field"
            }
            className="h-9 rounded-[10px] text-[13px]"
          >
            {saving ? "Saving…" : "Save"}
          </GatedButton>
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
