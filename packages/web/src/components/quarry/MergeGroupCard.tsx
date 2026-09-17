"use client"

import type { ReactNode } from "react"
import { FIELD_TYPE_LABELS } from "@/components/quarry/FieldTypeSelect"
import { Checkbox } from "@/components/ui/checkbox"
import type { MergeGroup } from "@/lib/api/types"
import { formatCount } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * One shape, and every table that has it. A group that cannot be ticked stays
 * visible with its fields and a plain reason — hiding it would leave the user
 * guessing why a table they can see is not in the list.
 */
export function MergeGroupCard({
  group,
  selected,
  closedReason,
  onToggleGroup,
  onToggleMember,
  conflict,
  className,
}: {
  group: MergeGroup
  selected: string[]
  /** Why this group takes no ticks right now. Printed, and it disables the boxes. */
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

  return (
    <section
      className={cn(
        "rounded-xl border bg-card p-4",
        conflict ? "border-error-border" : all || some ? "border-primary-tint-border" : "border-border-subtle",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          // A dash, not a tick, when only part of the group is picked.
          checked={all ? true : some ? "indeterminate" : false}
          disabled={closed}
          onCheckedChange={(next) => onToggleGroup(ids, next !== true ? false : true)}
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
          {/* Not an error — this group is simply not part of the combination
              being built, and the card says which one it is instead. */}
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
    </section>
  )
}
