"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CURRENCY_CODES, FIELD_TYPES, type CurrencyCode, type FieldType } from "@/lib/api/types"
import { cn } from "@/lib/utils"

/** The six types, in the order the schema editor lists them. */
export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "text",
  number: "number",
  date: "date",
  currency: "currency",
  boolean: "yes/no",
  list: "list",
}

export function FieldTypeSelect({
  value,
  onChange,
  label,
  disabled,
  className,
}: {
  value: FieldType
  onChange: (type: FieldType) => void
  /** Names the field, so the control is identifiable on a schema with 30 rows. */
  label: string
  disabled?: boolean
  className?: string
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as FieldType)} disabled={disabled}>
      <SelectTrigger
        aria-label={`Type of ${label}`}
        className={cn("h-8 w-[112px] rounded-lg bg-card font-mono text-[12px]", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FIELD_TYPES.map((type) => (
          <SelectItem key={type} value={type} className="font-mono text-[12px]">
            {FIELD_TYPE_LABELS[type]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Which currency a currency column is in — the second control, and only ever
 * beside a currency field.
 *
 * Answering is required. Not because the worker needs it — the code is never
 * checked against a cell, so a euro amount in a column marked USD stays in the
 * table rather than failing the row — but because a column of bare amounts
 * that does not say what they are amounts of is the thing this whole control
 * exists to stop shipping. Until it is answered it shows a placeholder and
 * reads as invalid, and the editor will not let the schema be saved.
 */
export function CurrencySelect({
  value,
  onChange,
  label,
  disabled,
  className,
}: {
  value: CurrencyCode | undefined
  onChange: (currency: CurrencyCode) => void
  /** Names the field, so the control is identifiable on a schema with 30 rows. */
  label: string
  disabled?: boolean
  className?: string
}) {
  return (
    <Select
      // "" rather than undefined: the control stays controlled from the first
      // render, and no item matches it, so the placeholder shows.
      value={value ?? ""}
      onValueChange={(next) => onChange(next as CurrencyCode)}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={`Currency of ${label}`}
        aria-invalid={value ? undefined : true}
        className={cn("h-8 w-[92px] rounded-lg bg-card font-mono text-[12px]", className)}
      >
        {/* The placeholder is a code rather than the word "currency": it says
            what kind of answer goes here in the shape the answer takes. It
            reads muted and the trigger reads invalid, so it cannot be
            mistaken for a USD that has been chosen. */}
        <SelectValue placeholder="USD" />
      </SelectTrigger>
      <SelectContent>
        {CURRENCY_CODES.map((code) => (
          <SelectItem key={code} value={code} className="font-mono text-[12px]">
            {code}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
