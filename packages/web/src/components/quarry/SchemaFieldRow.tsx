"use client"

import { CurrencySelect, FieldTypeSelect } from "@/components/quarry/FieldTypeSelect"
import type { CurrencyCode, FieldType, SchemaField } from "@/lib/api/types"
import { cn } from "@/lib/utils"

/**
 * The type controls are the only interactive things on the row. The name
 * renders mono with no input chrome and no hover affordance, because renaming
 * does not exist — and a greyed-out rename control would read as a bug on
 * every row of every schema.
 */
export function SchemaFieldRow({
  field,
  originalType,
  onChangeType,
  onChangeCurrency,
  currencyColumn,
  disabled,
  className,
}: {
  field: SchemaField
  /** What the document said, so a changed type can say it changed. */
  originalType?: FieldType
  onChangeType: (type: FieldType) => void
  onChangeCurrency?: (currency: CurrencyCode) => void
  /**
   * Some field in this schema is a currency, so every row holds the space for
   * the second control whether or not it has one. Without it the type selects
   * step in and out by a hundred pixels down a thirty-row schema.
   */
  currencyColumn?: boolean
  disabled?: boolean
  className?: string
}) {
  const changed = originalType !== undefined && originalType !== field.type
  const added = field.origin === "added"

  return (
    <div
      data-state={added ? "added-by-you" : changed ? "type-changed" : "detected"}
      className={cn(
        "grid min-h-[44px] items-center gap-3 border-b border-border-faint px-3 py-2 last:border-b-0",
        currencyColumn ? "grid-cols-[1fr_112px_92px]" : "grid-cols-[1fr_112px]",
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
      {currencyColumn &&
        (field.type === "currency" && onChangeCurrency ? (
          <CurrencySelect
            value={field.currency}
            onChange={onChangeCurrency}
            label={field.key}
            disabled={disabled}
          />
        ) : (
          /* The reserved cell, holding the column open for the rows that do
             have a currency. */
          <span aria-hidden />
        ))}
    </div>
  )
}
