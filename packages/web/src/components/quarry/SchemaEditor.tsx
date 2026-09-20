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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatCount } from "@/lib/format"
import type { Failure, FieldType } from "@/lib/api/types"
import {
  addField,
  changeFieldCurrency,
  changeFieldType,
  isEdited,
  sameFields,
  type SchemaState,
  type UpdateTarget,
} from "@/lib/schema"
import { cn } from "@/lib/utils"

/** Which of the two writes is in flight, so each button speaks only for itself. */
type Commit = "save" | "update"

/** One of the tables the panel can be pointed at, as the dropdown lists it. */
export type PanelTable = { schemaId: string; label: string }

type EditState = {
  schemaId: string | null
  /**
   * The committed fields this draft was made from. Kept so the draft can follow
   * the panel to another table — see `carriesOver`.
   */
  baseline: SchemaState["current"]
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
  /**
   * The tables this panel can be pointed at — every table in the group it was
   * opened from. Two or more of them put a dropdown under the heading, because
   * the panel picked one of them on the reader's behalf and the write goes to
   * whichever one is showing.
   */
  tables?: PanelTable[]
  onPickTable?: (schemaId: string) => void
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
  tables,
  onPickTable,
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
      : edit && schema && carriesOver(edit, schema)
        ? // Moved to a sibling table with the edit still in hand.
          { ...edit, schemaId, baseline: schema.current, picking: false, done: null, failure: null }
        : {
            schemaId,
            baseline: schema?.current ?? [],
            draft: schema?.current ?? [],
            picking: false,
            done: null,
            failure: null,
          }

  const { draft, picking, done, failure } = current
  const busy = committing !== null
  const patch = (next: Partial<EditState>) => setEdit({ ...current, ...next })
  const setDraft = (update: (fields: SchemaState["current"]) => SchemaState["current"]) =>
    patch({ draft: update(draft), done: null })

  // What is on the server now — which after a write is what we just sent, whether
  // or not the screen above has caught up with it yet.
  const committed = done?.fields ?? schema?.current ?? []

  // Held open for the whole card the moment any one field is a currency, so
  // the type selects do not step sideways from row to row.
  const hasCurrency = draft.some((field) => field.type === "currency")
  // A currency column that does not say which currency is an unfinished edit,
  // not a saveable one: it would go out as a table of bare amounts that names
  // no unit, which is the thing the second control exists to prevent.
  const unpriced = draft.find((field) => field.type === "currency" && !field.currency)
  // Everything a write would carry, not only the shape: swapping a column's
  // code from USD to EUR changes no shape at all and is still a change.
  const dirty = schema ? !sameFields(draft, committed) : false

  // This table is on the server exactly as it is on screen, and was put there
  // from here — which is the only state in which Update has nothing left to say.
  const saved = done?.kind === "save" && !dirty

  /**
   * What stops either write, whichever one is pressed.
   *
   * `busy` gates both even while only one is in flight: the label only changes
   * to "Updating…" for its own kind, but a second click must not start a write
   * racing the first.
   */
  const writeReason = busy
    ? "A write is already in progress"
    : unpriced
      ? `Choose a currency for ${unpriced.key}`
      : null

  /**
   * Whether this schema is worth pushing onto anything else.
   *
   * An edit in hand is the ordinary case — the wide write carries it to this
   * table and the chosen ones in a single write, so it does not wait on the
   * narrow one. Failing that, it is worth offering if this schema has already
   * been changed: saved here just now, or saved before this screen ever loaded.
   * Untouched, it is the shape the document gave, and every table it would
   * reach already has it.
   */
  const spreadable = schema ? dirty || done?.kind === "save" || isEdited(schema) : false
  const note = schema ? footerNote(schema, current, unpriced?.key) : null

  // The card this editor was opened from says "Unsaved changes" while there is
  // one. Reported from an effect rather than during render, and cleared on the
  // way out, so closing the panel or moving to another table takes it with it.
  useEffect(() => {
    if (!dirty || !schemaId) return
    onDraftChange?.(schemaId)
    return () => onDraftChange?.(null)
  }, [dirty, schemaId, onDraftChange])

  /**
   * One write with two target lists. Update sends the table on screen alone; an
   * update-all sends it and whichever others were chosen — the table in the
   * dropdown is never one of the choices, because it is always written.
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
          sourceLabel={labelOf(tables, schema)}
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

  const picker = tables && tables.length > 1 && onPickTable

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="min-w-0 flex-1">
          {/* A file name is mono because it is a literal string on disk. A
              heading the screen wrote — "Schema of 38 tables" — is prose. */}
          <p className={cn("truncate text-[13px] font-medium", !title && "font-mono")}>
            {title ?? fileName}
          </p>
          {picker ? (
            // The panel opened on one of the group's tables without being
            // asked, and the writes below go to whichever one this names. It
            // is a control rather than a caption because that choice is the
            // reader's, not the screen's.
            <Select
              value={schemaId ?? ""}
              onValueChange={onPickTable}
              disabled={frozen || busy}
            >
              <SelectTrigger
                aria-label="Table being edited"
                className="mt-1.5 h-8 w-full rounded-lg bg-card font-mono text-[12px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tables.map((table) => (
                  <SelectItem
                    key={table.schemaId}
                    value={table.schemaId}
                    className="font-mono text-[12px]"
                  >
                    {table.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            (subtitle ?? schema) && (
              <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                {subtitle ?? `${schema!.tableLabel} · version ${schema!.version}`}
              </p>
            )
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
          // `shrink-0` is what makes this column scroll. Without it the card
          // is a flex item that may shrink, and `overflow-hidden` lets it
          // shrink to nothing — so a schema of thirty fields quietly clipped
          // its last rows instead of overflowing the scroller above.
          <div className="shrink-0 overflow-hidden rounded-xl border border-border-subtle bg-card">
            {draft.map((field) => (
              <SchemaFieldRow
                key={field.key}
                field={field}
                originalType={schema.original.find((f) => f.key === field.key)?.type}
                disabled={frozen || busy}
                currencyColumn={hasCurrency}
                onChangeType={(type) => setDraft((fields) => changeFieldType(fields, field.key, type))}
                onChangeCurrency={(currency) =>
                  setDraft((fields) => changeFieldCurrency(fields, field.key, currency))
                }
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
                  sourceLabel={labelOf(tables, schema)}
                  reason={writeReason ?? (spreadable ? null : "Nothing has changed to push")}
                  onSelect={() => patch({ picking: true })}
                  onUpdateAll={() =>
                    void commit("update", updateTargets.map((t) => t.schema.schemaId))
                  }
                  className="flex-1"
                />
                <GatedButton
                  onClick={() => void commit("save")}
                  hideReason
                  reason={writeReason ?? (dirty ? null : "Nothing changed yet")}
                  variant={saved ? "outline" : "default"}
                  className={cn(
                    "h-9 shrink-0 gap-1.5 rounded-[10px] text-[13px]",
                    saved && "bg-card",
                  )}
                >
                  {saved && <Check aria-hidden className="size-3.5" />}
                  {committing === "save" ? "Updating…" : saved ? "Updated" : "Update"}
                </GatedButton>
              </div>

              {/* One line, and only when it has something to say: why a write
                  is shut, or what the last one actually reached. */}
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

/**
 * Whether an edit in progress follows the panel to another table.
 *
 * The dropdown moves between the tables of one group — the tables that share a
 * shape — so a change made against any of them fits all of them. Dropping it on
 * the way would make choosing which file to write to cost the change being
 * written, which is the one thing that choice must not do.
 */
function carriesOver(edit: EditState, schema: SchemaState): boolean {
  return !sameFields(edit.draft, edit.baseline) && sameFields(schema.current, edit.baseline)
}

/** How the dropdown names this table, so the rest of the panel agrees with it. */
const labelOf = (tables: PanelTable[] | undefined, schema: SchemaState): string =>
  tables?.find((table) => table.schemaId === schema.schemaId)?.label ?? schema.fileName

function footerNote(schema: SchemaState, { done }: EditState, unpriced?: string): string | null {
  // Ahead of everything else: it is the one state the reader cannot leave by
  // pressing anything in the footer, so the footer has to say where to go.
  if (unpriced) return `Choose the currency ${unpriced} is in.`
  if (done?.kind === "save") return `Version ${schema.version} committed for this table.`
  if (done?.kind === "update") {
    return done.others === 0
      ? "Updated this table."
      : `Updated this table and ${formatCount(done.others)} ${
          done.others === 1 ? "other" : "others"
        }.`
  }
  return null
}
