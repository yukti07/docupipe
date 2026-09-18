"use client"

import { Filter, X } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/**
 * One column's filter: rows are kept where this column contains the text.
 *
 * It sits beside the sort button rather than replacing it — a header that both
 * sorts and opens a filter on the same press can only do one of them, and
 * sorting is the one people reach for by habit.
 *
 * The box is a separate piece of state from the applied filter, so typing does
 * not re-run the row model on every keystroke over ten thousand rows. It is
 * applied on submit or on Escape-free blur, and cleared in one press.
 */
export function ColumnFilter({
  column,
  value,
  onChange,
}: {
  /** What the header says, for the label — the column id is the field key. */
  column: string
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const active = value.trim().length > 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={active ? `Filter on ${column} — “${value}”` : `Filter ${column}`}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
            active
              ? "bg-primary-tint text-primary"
              : "text-muted-foreground/60 hover:bg-muted hover:text-foreground",
          )}
        >
          <Filter aria-hidden className="size-3" strokeWidth={2} />
        </button>
      </PopoverTrigger>

      {/* Mounted only while open, which is what makes the box start from what
          is actually applied — including a clear made from the chip row while
          this was shut — without an effect that writes state on every open. */}
      <PopoverContent align="start" className="w-64 rounded-xl p-3">
        <FilterForm
          column={column}
          value={value}
          onApply={(next) => {
            onChange(next)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function FilterForm({
  column,
  value,
  onApply,
}: {
  column: string
  value: string
  onApply: (value: string) => void
}) {
  // Separate from the applied filter, so typing does not re-run the row model
  // on every keystroke over ten thousand rows.
  const [draft, setDraft] = useState(value)

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onApply(draft)
      }}
      className="flex flex-col gap-2"
    >
      <label htmlFor={`filter-${column}`} className="text-[12px] text-muted-foreground">
        Keep rows where <span className="font-mono text-foreground">{column}</span> contains
      </label>
      <Input
        id={`filter-${column}`}
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Any text"
        className="h-8 rounded-lg text-[12.5px]"
      />
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={draft === "" && value === ""}
          onClick={() => onApply("")}
          className="h-8 gap-1.5 rounded-lg text-[12.5px]"
        >
          <X aria-hidden className="size-3.5" />
          Clear
        </Button>
        <Button type="submit" size="sm" className="h-8 rounded-lg text-[12.5px]">
          Apply
        </Button>
      </div>
    </form>
  )
}

/** The filters in force, above the table, each one removable where it is read. */
export function ActiveFilters({
  filters,
  onRemove,
  onClearAll,
  className,
}: {
  filters: { id: string; value: string }[]
  onRemove: (id: string) => void
  onClearAll: () => void
  className?: string
}) {
  if (filters.length === 0) return null

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
        Filtered by
      </span>
      {filters.map((filter) => (
        <button
          key={filter.id}
          type="button"
          onClick={() => onRemove(filter.id)}
          aria-label={`Remove the filter on ${filter.id}`}
          className="flex items-center gap-1.5 rounded-lg border border-primary-tint-border bg-primary-tint px-2 py-1 text-[11.5px] hover:bg-primary-tint-strong"
        >
          <span className="font-mono">{filter.id}</span>
          <span className="text-muted-foreground">contains</span>
          <span className="max-w-[12rem] truncate font-medium">{filter.value}</span>
          <X aria-hidden className="size-3 text-muted-foreground" />
        </button>
      ))}
      {filters.length > 1 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearAll}
          className="h-7 rounded-lg text-[11.5px]"
        >
          Clear all
        </Button>
      )}
    </div>
  )
}
