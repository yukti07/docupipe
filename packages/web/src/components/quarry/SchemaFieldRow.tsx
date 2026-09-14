"use client"

import { FieldTypeSelect } from "@/components/quarry/FieldTypeSelect"
import type { FieldType, SchemaField } from "@/lib/api/types"
import { cn } from "@/lib/utils"

/**
 * The type control is the only interactive thing on the row. The name renders
 * mono with no input chrome and no hover affordance, because renaming does not
 * exist — and a greyed-out rename control would read as a bug on every row of
 * every schema.
 */
export function SchemaFieldRow({
  field,
  originalType,
  onChangeType,
  disabled,
  className,
}: {
  field: SchemaField
  /** What the document said, so a changed type can say it changed. */
  originalType?: FieldType
  onChangeType: (type: FieldType) => void
  disabled?: boolean
  className?: string
}) {
  const changed = originalType !== undefined && originalType !== field.type
  const added = field.origin === "added"

  return (
    <div
      data-state={added ? "added-by-you" : changed ? "type-changed" : "detected"}
      className={cn(
        "grid min-h-[44px] grid-cols-[1fr_112px] items-center gap-3 border-b border-border-faint px-3 py-2 last:border-b-0",
        className,
      )}
    >
      <div className="min-w-0">
        <span className="block truncate font-mono text-[13px] font-medium text-foreground">
          {field.key}
        </span>
        {(added || changed) && (
          <span className="text-[11px] text-muted-foreground">
            {added ? "added by you" : `was ${originalType}`}
          </span>
        )}
      </div>
      <FieldTypeSelect
        value={field.type}
        onChange={onChangeType}
        label={field.key}
        disabled={disabled}
      />
    </div>
  )
}
