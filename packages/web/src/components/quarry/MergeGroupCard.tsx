"use client"

import type { ReactNode } from "react"
import { FIELD_TYPE_LABELS } from "@/components/quarry/FieldTypeSelect"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { MergeGroup } from "@/lib/api/types"
import { formatCount } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * One shape, and every table that has it.
 *
 * Each card carries its own selection and its own name, because one submit
 * combines several shapes at once — four tables of this shape and two of
 * another is one press. A group that cannot be ticked stays visible with its
 * fields and a plain reason; hiding it would leave the user guessing why a
 * table they can see is not in the list.
 */
export function MergeGroupCard({
  group,
  selected,
  name,
  onNameChange,
  closedReason,
  onToggleGroup,
  onToggleMember,
  conflict,
  className,
}: {
  group: MergeGroup
  selected: string[]
  /** What the merged table will be called. Only asked for once two are ticked. */
  name: string
  onNameChange: (name: string) => void
  /** Why this group takes no ticks at all. Printed, and it disables the boxes. */
  closedReason?: string
  onToggleGroup: (schemaIds: string[], next: boolean) => void
  onToggleMember: (schemaId: string, next: boolean) => void
  /** Rendered here, on the card that is the problem. */
  conflict?: ReactNode
  className?: string
}) {
  const ids = group.members.map((m) => m.schemaId)
  const chosen = ids.filter((id) => selected.includes(id))
  const all = chosen.length === ids.length && ids.length > 0
  const some = chosen.length > 0 && !all
  const rows = group.members.reduce((sum, m) => sum + m.rowCount, 0)
  const closed = Boolean(closedReason)
  const chosenRows = group.members
    .filter((m) => selected.includes(m.schemaId))
    .reduce((sum, m) => sum + m.rowCount, 0)

  const inputId = `merge-name-${group.shapeHash}`

  return (
    <section
      className={cn(
        "rounded-xl border bg-card p-4",
        conflict
          ? "border-error-border"
          : all || some
            ? "border-primary-tint-border"
            : "border-border-subtle",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          // A dash, not a tick, when only part of the group is picked.
          checked={all ? true : some ? "indeterminate" : false}
          disabled={closed}
          onCheckedChange={(next) => onToggleGroup(ids, next === true)}
          aria-label={`Select all ${group.members.length} tables with the ${group.name} shape`}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <p className={cn("text-[13px] font-medium", closed && "text-muted-foreground")}>
            {formatCount(group.members.length)}{" "}
            {group.members.length === 1 ? "table" : "tables"} · {group.name}
          </p>
          <p className="mt-0.5 truncate font-mono text-[11.5px] text-muted-foreground">
            {group.fields.map((f) => `${f.key} · ${FIELD_TYPE_LABELS[f.type]}`).join("  ·  ")}
          </p>
          <p className="mt-0.5 text-[11.5px] tabular-nums text-subtle-foreground">
            {formatCount(rows)} rows in total
          </p>
          {closedReason && (
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">{closedReason}</p>
          )}
        </div>
      </div>

      {conflict && <div className="mt-3">{conflict}</div>}

      <ul className="mt-3 flex flex-col gap-1">
        {group.members.map((member) => (
          <li key={member.schemaId}>
            <label
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-1.5 py-1",
                closed ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted",
              )}
            >
              <Checkbox
                checked={selected.includes(member.schemaId)}
                disabled={closed}
                onCheckedChange={(next) => onToggleMember(member.schemaId, next === true)}
                aria-label={`${member.fileName} · ${member.tableLabel}`}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                {member.fileName}
                <span className="text-muted-foreground"> · {member.tableLabel}</span>
              </span>
              <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                {formatCount(member.rowCount)} rows
                {member.toCheckCount > 0 ? ` · ${formatCount(member.toCheckCount)} to check` : ""}
              </span>
            </label>
          </li>
        ))}
      </ul>

      {/* The name appears only once this card is actually going to produce a
          table. An empty box under a card with nothing ticked is a question
          about something that is not happening. */}
      {chosen.length > 1 && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border-faint pt-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor={inputId} className="text-[12px] text-muted-foreground">
              Name for these {formatCount(chosen.length)} tables
            </Label>
            <Input
              id={inputId}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={group.name}
              className="h-9 rounded-lg text-[13px]"
            />
          </div>
          <p className="pb-2 text-[11.5px] tabular-nums text-subtle-foreground">
            {formatCount(chosenRows)} rows
          </p>
        </div>
      )}
    </section>
  )
}
