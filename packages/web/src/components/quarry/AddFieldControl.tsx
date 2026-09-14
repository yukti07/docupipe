"use client"

import { Plus } from "lucide-react"
import { useState } from "react"
import { FieldTypeSelect } from "@/components/quarry/FieldTypeSelect"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { FieldType, SchemaField } from "@/lib/api/types"
import { validateNewField } from "@/lib/schema"
import { cn } from "@/lib/utils"

/**
 * Name and type, inline. The entered value survives an invalid attempt — a
 * failed submit that clears the field makes the user do the work twice.
 */
export function AddFieldControl({
  fields,
  onAdd,
  disabled,
  className,
}: {
  fields: SchemaField[]
  onAdd: (name: string, type: FieldType) => void
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [type, setType] = useState<FieldType>("text")
  const [reason, setReason] = useState<string | null>(null)

  function submit() {
    const check = validateNewField(name, fields)
    if (!check.ok) {
      setReason(check.reason)
      return
    }
    onAdd(name, type)
    setName("")
    setType("text")
    setReason(null)
    setOpen(false)
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn("h-8 gap-1.5 rounded-lg bg-card text-[12.5px]", className)}
      >
        <Plus aria-hidden className="size-3.5" />
        Add field
      </Button>
    )
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={name}
          aria-label="New field name"
          aria-invalid={reason ? true : undefined}
          placeholder="Field name"
          onChange={(e) => {
            setName(e.target.value)
            setReason(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit()
            if (e.key === "Escape") setOpen(false)
          }}
          className="h-8 flex-1 rounded-lg font-mono text-[12.5px]"
        />
        <FieldTypeSelect value={type} onChange={setType} label="the new field" />
      </div>
      {/* Below the field, never replacing the label. */}
      {reason && <p className="text-[12px] text-error-strong">{reason}</p>}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={submit} className="h-8 rounded-lg text-[12.5px]">
          Add
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false)
            setReason(null)
          }}
          className="h-8 rounded-lg text-[12.5px]"
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
