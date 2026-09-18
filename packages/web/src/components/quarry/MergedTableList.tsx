"use client"

import { Undo2 } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import type { MergedTable } from "@/lib/api/types"
import { formatCount } from "@/lib/format"

/**
 * The merges this batch already has.
 *
 * Undo is here rather than only on the results list because this is the screen
 * where the decision was made, and a merge whose members cannot be got back is
 * a one-way door in a place that has no business being one. Nothing is moved
 * either way: a merge holds no rows.
 */
export function MergedTableList({
  merges,
  onUndo,
}: {
  merges: MergedTable[]
  onUndo: (mergeId: string) => Promise<void>
}) {
  const [undoing, setUndoing] = useState<string | null>(null)

  return (
    <section className="rounded-xl border border-border-subtle bg-card p-4">
      <h2 className="text-[13px] font-medium">
        {formatCount(merges.length)} merged {merges.length === 1 ? "table" : "tables"}
      </h2>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        These stand in for the tables they were made from, which is why those tables are no
        longer in the groups below.
      </p>

      <ul className="mt-3 flex flex-col gap-1">
        {merges.map((merge) => (
          <li
            key={merge.mergeId}
            className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-muted"
          >
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
              {merge.name}
            </span>
            <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
              {formatCount(merge.tableCount)} tables · {formatCount(merge.rowCount)} rows
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={undoing === merge.mergeId}
              onClick={async () => {
                setUndoing(merge.mergeId)
                try {
                  await onUndo(merge.mergeId)
                } finally {
                  setUndoing(null)
                }
              }}
              className="h-8 shrink-0 gap-1.5 rounded-lg text-[12.5px]"
            >
              <Undo2 aria-hidden className="size-3.5" />
              {undoing === merge.mergeId ? "Splitting…" : "Undo"}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
