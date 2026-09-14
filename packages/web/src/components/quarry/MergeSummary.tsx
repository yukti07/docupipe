"use client"

import { GatedButton } from "@/components/common/GatedButton"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Failure, MergeGroup } from "@/lib/api/types"
import { formatCount } from "@/lib/format"

/** What you will get, before you press — never a count discovered afterwards. */
export function MergeSummary({
  groups,
  selected,
  name,
  onNameChange,
  blockedReason,
  merging,
  failure,
  onMerge,
}: {
  groups: MergeGroup[]
  selected: string[]
  name: string
  onNameChange: (name: string) => void
  blockedReason: string | null
  merging: boolean
  failure: Failure | null
  onMerge: () => void
}) {
  const members = groups.flatMap((g) => g.members).filter((m) => selected.includes(m.schemaId))
  const rows = members.reduce((sum, m) => sum + m.rowCount, 0)
  const toCheck = members.reduce((sum, m) => sum + m.toCheckCount, 0)
  const fields = groups.find((g) => g.members.some((m) => selected.includes(m.schemaId)))?.fields ?? []

  return (
    <aside className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-card p-4">
      <div>
        <h2 className="text-[13px] font-medium">What you&apos;ll get</h2>
        <ul className="mt-2 flex flex-col gap-1 text-[12.5px] tabular-nums text-subtle-foreground">
          <li>
            {formatCount(members.length)} {members.length === 1 ? "table" : "tables"} selected
          </li>
          <li>{formatCount(rows)} rows in one table</li>
          {toCheck > 0 && <li className="text-review">{formatCount(toCheck)} cells worth a look</li>}
          {fields.length > 0 && (
            <li className="truncate font-mono text-[11.5px]">
              {fields.map((f) => f.key).join(", ")}
            </li>
          )}
        </ul>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="merge-name" className="text-[12.5px]">
          Name this merged table
        </Label>
        <Input
          id="merge-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="August invoices"
          className="h-9 rounded-lg text-[13px]"
        />
      </div>

      {failure && <FailureMessage failure={failure} />}

      <GatedButton reason={merging ? "Merging now" : blockedReason} onClick={onMerge}>
        {merging
          ? "Merging…"
          : members.length === 0
            ? "Merge"
            : `Merge ${formatCount(members.length)} ${members.length === 1 ? "table" : "tables"}`}
      </GatedButton>
    </aside>
  )
}
