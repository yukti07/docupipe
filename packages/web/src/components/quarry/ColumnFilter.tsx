"use client"

import { Check, ChevronRight, Filter, X } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { FieldType } from "@/lib/api/types"
import {
  ARITY,
  OPERATORS,
  OPERATOR_LABELS,
  type ColumnFilterValue,
  type Operator,
  describeOperand,
  isApplied,
} from "@/lib/filters"
import { cn } from "@/lib/utils"

/**
 * One column's filter, offering the operators its declared type supports.
 *
 * A number column is asked "is greater than", a text column "contains", and
 * neither is offered the other's question — which is the difference between a
 * table that merely looks structured and one that is.
 *
 * It sits beside the sort button rather than replacing it — a header that both
 * sorts and opens a filter on the same press can only do one of them, and
 * sorting is the one people reach for by habit.
 */
export function ColumnFilter({
  column,
  type,
  value,
  rows,
  unreadable,
  onChange,
}: {
  /** What the header says. Not the column id: the source column's is internal. */
  column: string
  type: FieldType
  value: ColumnFilterValue | undefined
  /** How many rows the column has, for the unreadable-cell note's denominator. */
  rows: number
  /** Counted on open rather than per render: it walks every row in the table. */
  unreadable: () => number
  onChange: (next: ColumnFilterValue | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const active = value !== undefined && isApplied(value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            active
              ? `Filter on ${column} — ${OPERATOR_LABELS[value.op]} ${describeOperand(value)}`.trim()
              : `Filter ${column}`
          }
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

      {/* Mounted only while open, which is what makes the form start from what
          is actually applied — including a clear made from the chip row while
          this was shut — without an effect that writes state on every open.
          It is also what keeps the unreadable count off the render path.

          `overflow-visible` is what lets the operator list hang off the side
          rather than being clipped by the panel it belongs to. */}
      <PopoverContent align="start" className="w-64 overflow-visible rounded-xl p-3">
        <FilterForm
          column={column}
          type={type}
          value={value}
          rows={rows}
          unreadable={unreadable()}
          onApply={(next) => {
            onChange(next)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/** The types whose cells are parsed, and so whose cells can fail to parse. */
const PARSED_AS: Partial<Record<FieldType, string>> = {
  number: "number",
  currency: "number",
  date: "date",
}

function FilterForm({
  column,
  type,
  value,
  rows,
  unreadable,
  onApply,
}: {
  column: string
  type: FieldType
  value: ColumnFilterValue | undefined
  rows: number
  unreadable: number
  onApply: (value: ColumnFilterValue | undefined) => void
}) {
  // Separate from the applied filter, so typing does not re-run the row model
  // on every keystroke over ten thousand rows.
  const [draft, setDraft] = useState<ColumnFilterValue>(
    value ?? { op: OPERATORS[type][0], value: "" },
  )

  const arity = ARITY[draft.op]
  const parsed = PARSED_AS[type]
  // Only the comparisons parse a cell, so only they can quietly drop the rows
  // whose text does not parse. The empty checks never look at the value.
  const warn = parsed !== undefined && unreadable > 0 && arity > 0

  const chooseOperator = (op: Operator) =>
    setDraft((current) => ({
      op,
      value: ARITY[op] === 0 ? "" : current.value,
      value2: ARITY[op] === 2 ? current.value2 : undefined,
    }))

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onApply(isApplied(draft) ? draft : undefined)
      }}
      className="flex flex-col gap-2"
    >
      <p className="text-[12px] text-muted-foreground">
        <span className="font-mono text-foreground">{column}</span>
      </p>

      <OperatorPicker
        column={column}
        options={OPERATORS[type]}
        value={draft.op}
        onChange={chooseOperator}
      />

      {arity === 1 && (
        <ValueInput
          type={type}
          label={`Value for ${column}`}
          value={draft.value}
          onChange={(next) => setDraft((current) => ({ ...current, value: next }))}
        />
      )}

      {arity === 2 && (
        <div className="flex items-center gap-2">
          <ValueInput
            type={type}
            label={`Lowest value for ${column}`}
            value={draft.value}
            onChange={(next) => setDraft((current) => ({ ...current, value: next }))}
          />
          <span className="shrink-0 text-[12px] text-muted-foreground">and</span>
          <ValueInput
            type={type}
            label={`Highest value for ${column}`}
            value={draft.value2 ?? ""}
            onChange={(next) => setDraft((current) => ({ ...current, value2: next }))}
          />
        </div>
      )}

      {warn && (
        <p className="text-[11.5px] leading-[1.4] text-muted-foreground">
          {unreadable} of {rows} cells here have no readable {parsed} — those rows won&apos;t match.
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={value === undefined && !isApplied(draft)}
          onClick={() => onApply(undefined)}
          className="h-8 gap-1.5 rounded-lg text-[12.5px]"
        >
          Clear
        </Button>
        {/* Disabled until the operator has what it needs, which is what keeps a
            half-typed filter from entering the table's state at all. */}
        <Button
          type="submit"
          size="sm"
          disabled={!isApplied(draft)}
          className="h-8 rounded-lg text-[12.5px]"
        >
          Apply
        </Button>
      </div>
    </form>
  )
}

/**
 * The operator, and the list of the ones this column allows.
 *
 * The list opens *beside* the panel rather than over it, anchored to the row it
 * came from, so the value field and Apply stay in view while an operator is
 * being chosen — picking "is between" and watching a second input appear is the
 * moment the form explains itself, and a menu covering it wastes that moment.
 *
 * It is rendered inside the popover rather than in a portal of its own. A
 * portalled menu is "outside" as far as the popover is concerned, so every pick
 * would dismiss the form it was filling in.
 */
function OperatorPicker({
  column,
  options,
  value,
  onChange,
}: {
  column: string
  options: readonly Operator[]
  value: Operator
  onChange: (op: Operator) => void
}) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && root.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-label={`Operator for ${column}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation()
            setOpen(false)
          }
        }}
        className={cn(
          "flex h-8 w-full items-center justify-between gap-2 rounded-lg border bg-card px-2.5 text-[12.5px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          open ? "border-primary bg-primary-tint/40" : "border-input hover:bg-muted",
        )}
      >
        <span className="truncate">{OPERATOR_LABELS[value]}</span>
        <ChevronRight
          aria-hidden
          className={cn("size-3.5 shrink-0 text-muted-foreground", open && "text-primary")}
        />
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={`Operators for ${column}`}
          // Left of the panel when there is no room to its right, which on a
          // narrow window is most of the time.
          className="absolute -top-1 left-full z-50 ml-2 max-h-[280px] w-[176px] overflow-auto rounded-xl border border-border-subtle bg-popover p-1 shadow-lg max-[560px]:left-auto max-[560px]:right-full max-[560px]:ml-0 max-[560px]:mr-2"
        >
          {options.map((op) => (
            <button
              key={op}
              type="button"
              role="option"
              aria-selected={op === value}
              onClick={() => {
                onChange(op)
                setOpen(false)
              }}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px]",
                op === value ? "bg-primary-tint text-foreground" : "hover:bg-muted",
              )}
            >
              <span className="truncate">{OPERATOR_LABELS[op]}</span>
              {op === value && (
                <Check aria-hidden className="size-3.5 shrink-0 text-primary" strokeWidth={2.4} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The value control, shaped by the column's type.
 *
 * A number is not an `<input type="number">`: `$1,000` has to be typeable, and
 * the operand then goes through the same parser as the cells it is compared
 * against. A date is a real date input, so the operand is ISO and the day-first
 * guess the cell parser makes never applies to what someone typed.
 */
function ValueInput({
  type,
  label,
  value,
  onChange,
}: {
  type: FieldType
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const numeric = type === "number" || type === "currency"
  // A date input renders its own format hint; a placeholder there is only
  // something for a screen reader to read out over the top of it.
  const placeholder =
    type === "date" ? undefined : numeric ? "Any number" : type === "list" ? "One item" : "Any text"

  return (
    <Input
      autoFocus
      aria-label={label}
      type={type === "date" ? "date" : "text"}
      inputMode={numeric ? "decimal" : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-8 min-w-0 rounded-lg text-[12.5px]"
    />
  )
}

/** The filters in force, above the table, each one removable where it is read. */
export function ActiveFilters({
  filters,
  onRemove,
  onClearAll,
  className,
}: {
  filters: { id: string; label: string; operator: string; operand: string }[]
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
          aria-label={`Remove the filter on ${filter.label}`}
          className="flex items-center gap-1.5 rounded-lg border border-primary-tint-border bg-primary-tint px-2 py-1 text-[11.5px] hover:bg-primary-tint-strong"
        >
          <span className="font-mono">{filter.label}</span>
          <span className="text-muted-foreground">{filter.operator}</span>
          {filter.operand && (
            <span className="max-w-[12rem] truncate font-medium">{filter.operand}</span>
          )}
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
