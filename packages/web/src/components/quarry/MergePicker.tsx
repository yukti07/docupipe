"use client"

import { useMemo, useState } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { MergeConflict } from "@/components/quarry/MergeConflict"
import { MergeGroupCard } from "@/components/quarry/MergeGroupCard"
import { MergeSummary } from "@/components/quarry/MergeSummary"
import { Button } from "@/components/ui/button"
import type { Failure, MergeConflictDetail, MergeGroup, MergeResult } from "@/lib/api/types"
import { formatCount } from "@/lib/format"

/**
 * Variant A: a full page, groups down the left, the summary beside them.
 * Merging never happens on its own, and the check is exact — same names, same
 * types, order-independent.
 */
export function MergePicker({
  groups,
  onMerge,
  onMerged,
}: {
  groups: MergeGroup[]
  onMerge: (schemaIds: string[], name: string) => Promise<MergeResult>
  onMerged: (result: Extract<MergeResult, { ok: true }>) => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [name, setName] = useState("")
  const [merging, setMerging] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [conflicts, setConflicts] = useState<MergeConflictDetail[]>([])

  const everyId = useMemo(() => groups.flatMap((g) => g.members.map((m) => m.schemaId)), [groups])

  // The shape the selection agrees on, if it agrees on one at all.
  const selectedGroups = groups.filter((g) => g.members.some((m) => selected.includes(m.schemaId)))

  const blockedReason =
    selected.length === 0
      ? "Tick the tables you want combined"
      : selected.length === 1
        ? "Pick at least two tables to combine"
        : selectedGroups.length > 1
          ? "These tables don't have the same fields and types"
          : null

  function toggleGroup(ids: string[], next: boolean) {
    setConflicts([])
    setSelected((current) =>
      next ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id)),
    )
  }

  function toggleMember(schemaId: string, next: boolean) {
    setConflicts([])
    setSelected((current) =>
      next ? [...new Set([...current, schemaId])] : current.filter((id) => id !== schemaId),
    )
  }

  async function merge() {
    setMerging(true)
    setFailure(null)
    setConflicts([])
    const result = await onMerge(selected, name.trim() || "Merged table")
    setMerging(false)
    if (result.ok) {
      onMerged(result)
      return
    }
    // The selection is preserved — you need it to fix the problem.
    setFailure(result.failure)
    setConflicts(result.conflicts)
  }

  if (groups.length === 0) {
    return (
      <EmptyState
        title="Nothing to combine yet"
        body="Tables appear here once files have finished converting."
      />
    )
  }

  if (everyId.length === 1) {
    return (
      <EmptyState
        title="There's only one table in this batch"
        body="Combining tables needs at least two that share a shape."
      />
    )
  }

  const conflictFor = (group: MergeGroup) =>
    conflicts.find((conflict) =>
      group.members.some(
        (member) =>
          selected.includes(member.schemaId) &&
          conflict.groups.some((g) =>
            g.tableNames.includes(`${member.fileName} · ${member.tableLabel}`),
          ),
      ),
    )

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12.5px] tabular-nums text-subtle-foreground">
            {formatCount(everyId.length)} finished tables in{" "}
            {formatCount(groups.length)} {groups.length === 1 ? "shape" : "shapes"}
          </p>
          {/* One click, and deliberately not the default. */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleGroup(everyId, selected.length !== everyId.length)}
            className="h-8 rounded-lg bg-card text-[12.5px]"
          >
            {selected.length === everyId.length ? "Select none" : "Select all"}
          </Button>
        </div>

        {groups.map((group) => (
          <MergeGroupCard
            key={group.shapeHash}
            group={group}
            selected={selected}
            onToggleGroup={toggleGroup}
            onToggleMember={toggleMember}
            conflict={(() => {
              const conflict = conflictFor(group)
              return conflict ? (
                <MergeConflict conflict={conflict} selectedCount={selected.length} />
              ) : undefined
            })()}
          />
        ))}
      </div>

      <MergeSummary
        groups={groups}
        selected={selected}
        name={name}
        onNameChange={setName}
        blockedReason={blockedReason}
        merging={merging}
        failure={failure}
        onMerge={merge}
      />
    </div>
  )
}
