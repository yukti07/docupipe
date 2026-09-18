"use client"

import { Check, ChevronDown, ChevronRight, FileText, Pencil, Sparkles } from "lucide-react"
import { useState } from "react"
import { StatusBadge, type StatusVariant } from "@/components/common/StatusBadge"
import { FIELD_TYPE_LABELS } from "@/components/quarry/FieldTypeSelect"
import { Button } from "@/components/ui/button"
import { formatCount } from "@/lib/format"
import { schemaStatus, type SchemaGroup, type SchemaStatus } from "@/lib/schema"
import { cn } from "@/lib/utils"

/** How many files are named on the face of the card before it starts counting. */
const NAMED = 2

/** The three things that can have happened to a schema, each said in one word. */
const STATUS: Record<SchemaStatus, { label: string; variant: StatusVariant; icon: typeof Check }> = {
  generated: { label: "Generated", variant: "neutral", icon: Sparkles },
  modified: { label: "Modified", variant: "success", icon: Check },
  unsaved: { label: "Unsaved changes", variant: "review", icon: Pencil },
}

/**
 * One card per *schema*, not per file — that is the whole point of the review
 * screen. Thirty-eight invoices that came back with the same six fields are one
 * decision, and this card is that decision.
 *
 * The fields are always on the face, because they are what is being reviewed.
 * The files behind them fold away, because on a forty-file batch they are the
 * part that would push every other card off the screen.
 */
export function SchemaGroupCard({
  group,
  selected,
  unsaved,
  defaultOpen,
  onOpen,
  className,
}: {
  group: SchemaGroup
  /** This group's schema is the one in the panel. */
  selected?: boolean
  /** The open editor is holding a draft of this group's schema. */
  unsaved?: boolean
  defaultOpen?: boolean
  onOpen: (schemaId: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen))

  const tables = group.schemas.length
  const files = [...new Set(group.schemas.map((s) => s.fileName))]
  const status = STATUS[schemaStatus(group.schemas, unsaved)]
  const shown = files.slice(0, NAMED)
  const rest = files.length - shown.length

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border bg-card transition-colors",
        // Which card is open is said by its edge, not by a button that has to
        // change its wording to say it — and not by a fill either, which would
        // put a wash of colour behind the fields that are the thing to read.
        selected ? "border-primary" : "border-border-subtle",
        className,
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={
            open ? `Hide the files with this schema` : `Show the files with this schema`
          }
          className="mt-0.5 shrink-0 rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {open ? (
            <ChevronDown aria-hidden className="size-4" />
          ) : (
            <ChevronRight aria-hidden className="size-4" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[13.5px] font-medium tabular-nums">
              {formatCount(tables)} {tables === 1 ? "table" : "tables"}
              {files.length === 1 && (
                <span className="font-normal text-muted-foreground">
                  {" · "}
                  <span className="font-mono text-[12px]">{files[0]}</span>
                </span>
              )}
            </p>
            <StatusBadge variant={status.variant} icon={status.icon}>
              {status.label}
            </StatusBadge>
          </div>

          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {group.schemas[0].current.map((field) => (
              <li
                key={field.key}
                className={cn(
                  "rounded-md border px-1.5 py-0.5 font-mono text-[11px]",
                  field.origin === "added"
                    ? "border-primary-tint-border bg-primary-tint text-foreground"
                    : "border-border-faint bg-muted text-subtle-foreground",
                )}
              >
                {field.key}
                <span className="text-muted-foreground"> · {FIELD_TYPE_LABELS[field.type]}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* A pencil and nothing else. The card already says what state this
            schema is in, and whether it is the one open. Pressing it again
            while it is open would only move the panel off the table someone
            picked inside this group. */}
        {/* One weight, open or not. Disabled is left to fade the way every
            other disabled button here does. */}
        <Button
          variant="outline"
          size="icon"
          disabled={selected}
          aria-label={selected ? "This schema is open in the panel" : "Edit this schema"}
          onClick={() => onOpen(group.schemas[0].schemaId)}
          // Puts a schema in the panel, so the panel's close-on-press-outside
          // leaves it alone rather than shutting under the press. See SplitPane.
          data-panel-open=""
          className="size-9 shrink-0 rounded-[10px] border-primary-tint-border bg-primary-tint text-primary hover:bg-primary-tint-strong hover:text-primary"
        >
          <Pencil aria-hidden className="size-3.5" />
        </Button>
      </div>

      {open && (
        <ul className="grid divide-x divide-y divide-border-faint border-t border-border-faint sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((name) => {
            // Several files can share a shape without sharing a schemaId — the
            // pencil above only ever opens the first, so this is the one place
            // a specific file's table can be reached from this card.
            const schemaId = group.schemas.find((s) => s.fileName === name)?.schemaId
            return (
              <li key={name} className="min-w-0">
                <button
                  type="button"
                  disabled={!schemaId}
                  onClick={() => schemaId && onOpen(schemaId)}
                  aria-label={`Edit the schema for ${name}`}
                  data-panel-open=""
                  className="flex w-full min-w-0 items-center gap-2 px-4 py-2.5 text-left hover:bg-muted disabled:pointer-events-none"
                >
                  <FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-[12px]">{name}</span>
                </button>
              </li>
            )
          })}
          {rest > 0 && (
            <li className="px-4 py-2.5 text-[12px] tabular-nums text-muted-foreground">
              and {formatCount(rest)} more
            </li>
          )}
        </ul>
      )}
    </section>
  )
}
