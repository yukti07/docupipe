"use client"

import type { ReactNode } from "react"
import { StatusBadge } from "@/components/common/StatusBadge"
import { FIELD_TYPE_LABELS } from "@/components/quarry/FieldTypeSelect"
import { formatCount } from "@/lib/format"
import { isEdited, type SchemaState } from "@/lib/schema"
import { cn } from "@/lib/utils"

/** One schema in the all-files view and, with a different trailing slot, the merge picker. */
export function SchemaCard({
  schema,
  sharedWith = 0,
  selected,
  onOpen,
  trailing,
  footer,
  className,
}: {
  schema: SchemaState
  /** How many other files started with this same shape. */
  sharedWith?: number
  selected?: boolean
  onOpen?: () => void
  trailing?: ReactNode
  /** A merge conflict renders here — on the offending card, not only in a summary. */
  footer?: ReactNode
  className?: string
}) {
  const edited = isEdited(schema)

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-[12.5px] font-medium">{schema.fileName}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
            {schema.tableLabel} · {formatCount(schema.current.length)} fields
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          {edited && <StatusBadge variant="neutral">Edited</StatusBadge>}
          {sharedWith > 0 && (
            <StatusBadge variant="neutral">
              Shared with {formatCount(sharedWith)}
            </StatusBadge>
          )}
          {trailing}
        </span>
      </div>

      <ul className="mt-3 flex flex-wrap gap-1.5">
        {schema.current.map((field) => (
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

      {footer}
    </>
  )

  const classes = cn(
    "w-full rounded-xl border bg-card px-4 py-3.5 text-left transition-colors",
    selected ? "border-primary-tint-border bg-primary-tint" : "border-border-subtle",
    onOpen && "hover:border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    className,
  )

  if (!onOpen) return <div className={classes}>{body}</div>

  return (
    <button type="button" onClick={onOpen} className={classes}>
      {body}
    </button>
  )
}
