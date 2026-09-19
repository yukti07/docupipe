"use client"

import { useMemo, useState } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { MergeConflict } from "@/components/quarry/MergeConflict"
import { MergeGroupCard } from "@/components/quarry/MergeGroupCard"
import { MergeSummary, type PlannedMerge } from "@/components/quarry/MergeSummary"
import { MergedTableList } from "@/components/quarry/MergedTableList"
import { Button } from "@/components/ui/button"
import { toFailure } from "@/lib/api"
import type {
  Failure,
  MergeConflictDetail,
  MergeGroup,
  MergeOverview,
  MergeResult,
  MergeSubmission,
} from "@/lib/api/types"
import { formatCount } from "@/lib/format"

/**
 * Groups down the left, what you will get beside them.
 *
 * **Several shapes at once.** Each group holds its own selection and its own
 * name, and one press writes all of them — four tables of one shape and two of
 * another come back as two merged tables and everything else untouched.
 * Combining is still exact within a group: same field names, same types.
 */
export function MergePicker({
  overview,
  onMerge,
  onUndo,
  onMerged,
}: {
  overview: MergeOverview
  onMerge: (merges: MergeSubmission[]) => Promise<MergeResult>
  onUndo: (mergeId: string) => Promise<void>
  onMerged: (result: Extract<MergeResult, { ok: true }>) => void
}) {
  // Keyed by shape, so a group's ticks and its name travel together and a
  // group that disappears on the next load takes its state with it.
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [names, setNames] = useState<Record<string, string>>({})
  const [merging, setMerging] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [conflicts, setConflicts] = useState<MergeConflictDetail[]>([])

  const { groups, merges, tableCount } = overview

  // `picked` is not derived from `overview`, so a table that has been combined
  // elsewhere can leave a ticked id behind in a group it is no longer in.
  // Every read goes through this rather than writing a pruned copy back into
  // state, so a stale id can never reach a submit.
  const selected = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const group of groups) {
      const live = new Set(group.members.map((m) => m.schemaId))
      out[group.shapeHash] = (picked[group.shapeHash] ?? []).filter((id) => live.has(id))
    }
    return out
  }, [groups, picked])

  const planned: PlannedMerge[] = useMemo(
    () =>
      groups
        .map((group) => {
          const ids = selected[group.shapeHash] ?? []
          const members = group.members.filter((m) => ids.includes(m.schemaId))
          return {
            shapeHash: group.shapeHash,
            groupName: group.name,
            name: names[group.shapeHash] ?? "",
            tables: members.length,
            rows: members.reduce((sum, m) => sum + m.rowCount, 0),
          }
        })
        // One table is not a merge, so it is not part of the plan — the card
        // says so by not asking for a name.
        .filter((plan) => plan.tables > 1),
    [groups, names, selected],
  )

  const halfPicked = groups.filter((g) => (selected[g.shapeHash] ?? []).length === 1)

  const blockedReason =
    planned.length === 0
      ? halfPicked.length > 0
        ? "Pick at least two tables in a group"
        : "Tick the tables you want combined"
      : null

  function toggleGroup(shapeHash: string, ids: string[], next: boolean) {
    setConflicts([])
    setPicked((current) => ({
      ...current,
      [shapeHash]: next
        ? [...new Set([...(current[shapeHash] ?? []), ...ids])]
        : (current[shapeHash] ?? []).filter((id) => !ids.includes(id)),
    }))
  }

  function toggleMember(shapeHash: string, schemaId: string, next: boolean) {
    setConflicts([])
    setPicked((current) => ({
      ...current,
      [shapeHash]: next
        ? [...new Set([...(current[shapeHash] ?? []), schemaId])]
        : (current[shapeHash] ?? []).filter((id) => id !== schemaId),
    }))
  }

  async function merge() {
    setMerging(true)
    setFailure(null)
    setConflicts([])
    try {
      const submissions: MergeSubmission[] = planned.map((plan) => ({
        name: plan.name.trim() || plan.groupName,
        schemaIds: selected[plan.shapeHash] ?? [],
      }))
      const result = await onMerge(submissions)
      if (result.ok) {
        setPicked({})
        setNames({})
        onMerged(result)
        return
      }
      // The selection is preserved — you need it to fix the problem.
      setFailure(result.failure)
      setConflicts(result.conflicts)
    } catch (error) {
      // A refusal is an answer; a thrown request is not. Without this the
      // button sits on "Combining…" for the rest of the session saying nothing.
      setFailure(toFailure(error))
    } finally {
      setMerging(false)
    }
  }

  const everyId = groups.flatMap((g) => g.members.map((m) => m.schemaId))
  const combinable = groups.filter((group) => group.members.length > 1)

  if (groups.length === 0 && merges.length === 0) {
    return (
      <EmptyState
        title="Nothing to combine yet"
        body="Tables appear here once files have finished converting."
      />
    )
  }

  /** Why this group takes no ticks — said on the card, never silently. */
  function closedReason(group: MergeGroup): string | undefined {
    if (group.members.length > 1) return undefined
    return "Nothing else in this batch has these fields, and a table can't be combined with itself."
  }

  const conflictFor = (group: MergeGroup) =>
    conflicts.find((conflict) => conflict.shapeHash === group.shapeHash)

  return (
    <div className="flex flex-col gap-6">
      {merges.length > 0 && <MergedTableList merges={merges} onUndo={onUndo} />}

      {groups.length === 0 ? (
        <EmptyState
          title="Everything here is already combined"
          body="Undo one of the merged tables above to put its tables back on their own."
        />
      ) : combinable.length === 0 ? (
        <EmptyState
          title="No two tables in this batch share a shape"
          body="Combining is exact — same field names, same types. Every table here has a shape of its own, so there is nothing to put together."
        />
      ) : (
        <div
          // `minmax(0,1fr)`, not `1fr`: a grid track's automatic minimum is its
          // min-content, and a long filename in the list would otherwise push
          // the summary — and the Combine button on it — off the right edge.
          className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start"
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12.5px] tabular-nums text-subtle-foreground">
                {formatCount(everyId.length)} tables still on their own, in{" "}
                {formatCount(groups.length)} {groups.length === 1 ? "shape" : "shapes"}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const full = combinable.every(
                    (g) => (selected[g.shapeHash] ?? []).length === g.members.length,
                  )
                  setConflicts([])
                  setPicked(
                    full
                      ? {}
                      : Object.fromEntries(
                          combinable.map((g) => [g.shapeHash, g.members.map((m) => m.schemaId)]),
                        ),
                  )
                }}
                className="h-8 rounded-lg bg-card text-[12.5px]"
              >
                {combinable.every(
                  (g) => (selected[g.shapeHash] ?? []).length === g.members.length,
                )
                  ? "Select none"
                  : "Select every group"}
              </Button>
            </div>

            {groups.map((group) => (
              <MergeGroupCard
                key={group.shapeHash}
                group={group}
                selected={selected[group.shapeHash] ?? []}
                name={names[group.shapeHash] ?? ""}
                onNameChange={(name) =>
                  setNames((current) => ({ ...current, [group.shapeHash]: name }))
                }
                closedReason={closedReason(group)}
                onToggleGroup={(ids, next) => toggleGroup(group.shapeHash, ids, next)}
                onToggleMember={(schemaId, next) =>
                  toggleMember(group.shapeHash, schemaId, next)
                }
                conflict={(() => {
                  const conflict = conflictFor(group)
                  return conflict ? (
                    <MergeConflict
                      conflict={conflict}
                      selectedCount={(selected[group.shapeHash] ?? []).length}
                    />
                  ) : undefined
                })()}
              />
            ))}
          </div>

          <MergeSummary
            planned={planned}
            tableCount={tableCount}
            blockedReason={blockedReason}
            merging={merging}
            failure={failure}
            onMerge={merge}
          />
        </div>
      )}
    </div>
  )
}
