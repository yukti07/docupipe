"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FIELD_TYPES, type FieldType } from "@/lib/api/types"
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
