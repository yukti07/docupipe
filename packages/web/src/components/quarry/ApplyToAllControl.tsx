"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatCount } from "@/lib/format"
import type { SchemaState } from "@/lib/schema"
import { cn } from "@/lib/utils"

/**
 * The count is the whole value of the feature, so it lives in the label. And it
 * never applies straight from the button: pressing it shows which files it
 * would touch first.
 */
export function ApplyToAllControl({
  targets,
  checked,
  onCheckedChange,
  className,
}: {
  /** Schemas whose ORIGINAL shape matched this one's original shape. */
  targets: SchemaState[]
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)

  if (targets.length === 0) {
    return (
      <p className={cn("text-[12px] text-muted-foreground", className)}>
        No other file started with this shape.
      </p>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={checked ? "default" : "outline"}
          size="sm"
          className={cn("h-8 rounded-lg text-[12.5px]", !checked && "bg-card", className)}
        >
          {checked ? "Applying to" : "Apply to"} {formatCount(targets.length)}{" "}
          {targets.length === 1 ? "file" : "files"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] rounded-xl p-4">
        <p className="text-[13px] font-medium">
          {formatCount(targets.length)} other {targets.length === 1 ? "file" : "files"} started with
          this shape
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Saving will write these same fields onto each of them.
        </p>
        <ScrollArea className="mt-3 max-h-44">
          <ul className="flex flex-col gap-1 pr-3">
            {targets.map((target) => (
              <li
                key={target.schemaId}
                className="truncate font-mono text-[11.5px] text-subtle-foreground"
              >
                {target.fileName}
                {target.tableLabel ? ` · ${target.tableLabel}` : ""}
              </li>
            ))}
          </ul>
        </ScrollArea>
        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              onCheckedChange(!checked)
              setOpen(false)
            }}
            className="h-8 rounded-lg text-[12.5px]"
          >
            {checked ? "Just this file" : `Include these ${formatCount(targets.length)}`}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpen(false)}
            className="h-8 rounded-lg text-[12.5px]"
          >
            Cancel
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
