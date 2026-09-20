"use client"

import { ArrowRight, ChevronDown, ChevronUp, ListChecks } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatCount } from "@/lib/format"
import type { UpdateTarget } from "@/lib/schema"
import { cn } from "@/lib/utils"

/**
 * Pushing this schema past the table on screen — the one control here that
 * reaches files nobody is looking at, so it never fires straight from the
 * button. Opening it offers the two ways of meaning it: pick the tables by
 * hand, or take the lot.
 *
 * An unsaved edit does not shut it. The write is one write: it carries the
 * change to the table on screen and to every table chosen beside it, so there
 * is no draft going out that this table has not taken too. It does stay shut
 * while this schema is still exactly what the document gave, since then there
 * is nothing to spread but the shape those tables already have.
 */
export function UpdateOthersControl({
  targets,
  sourceLabel,
  onSelect,
  onUpdateAll,
  updating,
  reason,
  className,
}: {
  targets: UpdateTarget[]
  /**
   * The table on screen. It is never one of the targets — every write includes
   * it — so it is named here to be listed among them rather than chosen.
   */
  sourceLabel?: string
  /** Open the picker. */
  onSelect: () => void
  /** Write onto every target at once. */
  onUpdateAll: () => void
  updating?: boolean
  /**
   * Present means shut, and the string says why — in the accessible name, the
   * way `GatedButton` does it. A dead control with no reason on a panel this
   * dense is a button people press twice and then give up on.
   */
  reason?: string | null
  className?: string
}) {
  const [open, setOpen] = useState(false)
  // "Update all" writes onto every target with one more click than "Select
  // tables" needs — this is that click. It replaces the menu's two choices
  // with the list of files it is about to reach, the same thing the picker
  // shows before "Select tables" ever writes anything.
  const [confirming, setConfirming] = useState(false)

  // Counted with the table on screen, because that is what the write reaches.
  const reached = targets.length + 1
  const count = formatCount(reached)
  const differing = targets.filter((t) => t.added.length > 0).length

  if (targets.length === 0) {
    return (
      <p className={cn("text-[12px] text-muted-foreground", className)}>
        No other table has these fields.
      </p>
    )
  }

  const label = "Update All"

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) setConfirming(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={Boolean(reason) || updating}
          aria-label={reason ? `${label} — ${reason}` : undefined}
          className={cn("h-9 justify-between gap-1.5 rounded-[10px] bg-card text-[12.5px]", className)}
        >
          {updating ? `Updating ${count} ${reached === 1 ? "table" : "tables"}…` : label}
          {open ? (
            <ChevronUp aria-hidden className="size-3.5 opacity-60" />
          ) : (
            <ChevronDown aria-hidden className="size-3.5 opacity-60" />
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" className="w-[330px] rounded-xl p-1.5">
        {confirming ? (
          <div className="flex flex-col gap-2 p-1">
            <p className="px-1.5 pt-1 text-[12.5px] font-medium">
              Write onto all {count} matching {reached === 1 ? "table" : "tables"}?
            </p>
            <ScrollArea className="max-h-40">
              <ul className="flex flex-col gap-1 px-1.5">
                {/* First, and not as a target: the table on screen takes this
                    schema whatever else is chosen, so a list that left it out
                    would under-report what the button is about to do. */}
                {sourceLabel && (
                  <li className="truncate font-mono text-[11.5px] text-foreground">
                    {sourceLabel}
                    <span className="font-sans text-muted-foreground"> · this table</span>
                  </li>
                )}
                {targets.map((target) => (
                  <li
                    key={target.schema.schemaId}
                    className="truncate font-mono text-[11.5px] text-subtle-foreground"
                  >
                    {target.schema.fileName}
                    {target.schema.tableLabel ? ` · ${target.schema.tableLabel}` : ""}
                  </li>
                ))}
              </ul>
            </ScrollArea>
            <div className="flex items-center gap-2 px-1 pt-1">
              <Button
                size="sm"
                onClick={() => {
                  setOpen(false)
                  setConfirming(false)
                  onUpdateAll()
                }}
                className="h-8 rounded-lg text-[12.5px]"
              >
                Update {count} {reached === 1 ? "table" : "tables"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(false)}
                className="h-8 rounded-lg text-[12.5px]"
              >
                Back
              </Button>
            </div>
          </div>
        ) : (
          <>
            <DropdownMenuItem
              onSelect={onSelect}
              className="items-start gap-2.5 rounded-lg px-2.5 py-2.5 focus:bg-primary-tint"
            >
              <ListChecks aria-hidden className="mt-0.5 size-4 text-primary" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] font-medium">Select tables</span>
                <span className="text-[12px] text-muted-foreground">
                  Choose which of the {count} matching tables take this schema.
                </span>
              </span>
            </DropdownMenuItem>

            <DropdownMenuItem
              onSelect={(event) => {
                // Stays open — the next click needs the list this prevents
                // Radix from closing on.
                event.preventDefault()
                setConfirming(true)
              }}
              className="items-start gap-2.5 rounded-lg px-2.5 py-2.5"
            >
              <ArrowRight aria-hidden className="mt-0.5 size-4" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] font-medium">Update all matching tables</span>
                {/* The near-matches are the part worth knowing before taking the
                    lot — they are the ones that gain a field they never had. */}
                <span className="text-[12px] text-muted-foreground">
                  All at once.
                  {differing > 0 && ` ${formatCount(differing)} of them differ by a field.`}
                </span>
              </span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
