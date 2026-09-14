import { CircleX } from "lucide-react"
import { FIELD_TYPE_LABELS } from "@/components/quarry/FieldTypeSelect"
import type { MergeConflictDetail } from "@/lib/api/types"
import { formatCount } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Names the table, the field and the disagreement — and renders on the
 * offending card, not only in a summary at the bottom. The user needs to see
 * *which* selection is the problem, not only that there is one.
 */
export function MergeConflict({
  conflict,
  selectedCount,
  className,
}: {
  conflict: MergeConflictDetail
  /** How many tables are selected, so "absent from the rest" can be said exactly. */
  selectedCount?: number
  className?: string
}) {
  const present = conflict.groups.reduce((sum, group) => sum + group.tableNames.length, 0)
  const missing = selectedCount === undefined ? 0 : selectedCount - present

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-[10px] border border-error-border bg-error-bg px-3 py-2.5 text-[12px] leading-[1.5] text-error-strong",
        className,
      )}
    >
      <CircleX aria-hidden className="mt-px size-3.5 shrink-0" strokeWidth={1.9} />
      <div className="min-w-0">
        <p className="font-medium">
          <span className="font-mono">{conflict.field}</span>{" "}
          {conflict.groups.length > 1 ? "disagrees across these tables" : "is missing from some of them"}
        </p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {conflict.groups.map((group) => (
            <li key={group.type}>
              <span className="font-mono">{FIELD_TYPE_LABELS[group.type]}</span> in{" "}
              {formatCount(group.tableNames.length)}{" "}
              {group.tableNames.length === 1 ? "table" : "tables"} — {group.tableNames.join(", ")}
            </li>
          ))}
          {missing > 0 && (
            <li>
              absent from {formatCount(missing)} other{" "}
              {missing === 1 ? "table" : "tables"} in this selection
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}
