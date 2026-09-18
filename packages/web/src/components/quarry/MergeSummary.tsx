"use client"

import { GatedButton } from "@/components/common/GatedButton"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import type { Failure } from "@/lib/api/types"
import { formatCount } from "@/lib/format"

export type PlannedMerge = { shapeHash: string; groupName: string; name: string; rows: number; tables: number }

/** What you will get, before you press — never a count discovered afterwards. */
export function MergeSummary({
  planned,
  /** Tables in the batch right now, counting each existing merge as one. */
  tableCount,
  blockedReason,
  merging,
  failure,
  onMerge,
}: {
  planned: PlannedMerge[]
  tableCount: number
  blockedReason: string | null
  merging: boolean
  failure: Failure | null
  onMerge: () => void
}) {
  const tablesIn = planned.reduce((sum, p) => sum + p.tables, 0)
  const rows = planned.reduce((sum, p) => sum + p.rows, 0)
  // Each merge takes its members out of the list and puts one back.
  const after = tableCount - tablesIn + planned.length

  return (
    <aside className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-card p-4 lg:sticky lg:top-6">
      <div>
        <h2 className="text-[13px] font-medium">What you&apos;ll get</h2>

        {planned.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            Tick two or more tables in any group. You can do several groups at once — they
            are combined separately, one merged table each.
          </p>
        ) : (
          <>
            <ul className="mt-2 flex flex-col gap-1.5">
              {planned.map((plan) => (
                <li key={plan.shapeHash} className="text-[12.5px]">
                  <span className="font-medium">{plan.name || plan.groupName}</span>
                  <span className="tabular-nums text-subtle-foreground">
                    {" "}
                    — {formatCount(plan.tables)} tables, {formatCount(plan.rows)} rows
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12.5px] tabular-nums text-subtle-foreground">
              {formatCount(tablesIn)} tables become {formatCount(planned.length)}.{" "}
              {formatCount(rows)} rows are unchanged.
            </p>
            <p className="mt-1 text-[12.5px] font-medium tabular-nums">
              {formatCount(tableCount)} tables in this batch → {formatCount(after)}
            </p>
          </>
        )}
      </div>

      {failure && <FailureMessage failure={failure} />}

      <GatedButton reason={merging ? "Combining now" : blockedReason} onClick={onMerge}>
        {merging
          ? "Combining…"
          : planned.length === 0
            ? "Combine"
            : planned.length === 1
              ? `Combine ${formatCount(tablesIn)} tables`
              : `Combine ${formatCount(tablesIn)} tables into ${formatCount(planned.length)}`}
      </GatedButton>
    </aside>
  )
}
