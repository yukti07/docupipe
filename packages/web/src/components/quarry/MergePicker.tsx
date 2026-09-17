"use client"

import { useMemo, useState } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { MergeConflict } from "@/components/quarry/MergeConflict"
import { MergeGroupCard } from "@/components/quarry/MergeGroupCard"
import { MergeSummary } from "@/components/quarry/MergeSummary"
import { Button } from "@/components/ui/button"
import { toFailure } from "@/lib/api"
import type { Failure, MergeConflictDetail, MergeGroup, MergeResult } from "@/lib/api/types"
import { formatCount } from "@/lib/format"

/**
 * Variant A: a full page, groups down the left, the summary beside them.
 * Merging never happens on its own, and the check is exact — same names, same
 * types, order-independent.
 *
 * **One shape at a time.** The check the server runs is the check this screen
 * enforces: the moment a table is ticked, every other shape closes. Letting a
 * selection be built across shapes and then refusing it at the end blames the
 * user for a combination the screen offered them.
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
  const [rawSelected, setSelected] = useState<string[]>([])
  const [name, setName] = useState("")
  const [merging, setMerging] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [conflicts, setConflicts] = useState<MergeConflictDetail[]>([])

  const everyId = useMemo(() => groups.flatMap((g) => g.members.map((m) => m.schemaId)), [groups])

  // The shape the selection is in, which is the only one anything can be added
  // to while it stands.
  const owner = groups.find((g) => g.members.some((m) => rawSelected.includes(m.schemaId))) ?? null

  // `rawSelected` is not derived from `groups`, so a table that changes shape
  // elsewhere (edited in an open panel, or a fresh poll response) can leave a
  // ticked id behind in a group it no longer belongs to — `owner` above would
  // then just be whichever group holds any *other* still-ticked id, silently
  // dropping the stale one from consideration everywhere but the array itself.
  // Filtering it out of every read below, rather than writing a pruned array
  // back into state, is what keeps a merge from ever being submitted across
  // two shapes; without it that guarantee lived only in the checkboxes being
  // disabled, which a stale id already past that check was never subject to.
  const active = owner
  const selected = useMemo(() => {
    if (rawSelected.length === 0) return rawSelected
    const validIds = new Set(owner?.members.map((m) => m.schemaId) ?? [])
    return rawSelected.filter((id) => validIds.has(id))
  }, [rawSelected, owner])

  const blockedReason =
    selected.length === 0
      ? "Tick the tables you want combined"
      : selected.length === 1
        ? "Pick at least two tables to combine"
        : null

  /** Why this group takes no ticks right now — said on the card, never silently. */
  function closedReason(group: MergeGroup): string | undefined {
    if (group.members.length < 2) {
      return "Nothing else in this batch has these fields, and a table can't be combined with itself."
    }
    if (active && active.shapeHash !== group.shapeHash) {
      return `Different fields from the ${formatCount(active.members.length)} ${
        active.members.length === 1 ? "table" : "tables"
      } in ${active.name}. Clear that selection to combine these instead.`
    }
    return undefined
  }

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
    try {
      const result = await onMerge(selected, name.trim() || "Merged table")
      if (result.ok) {
        onMerged(result)
        return
      }
      // The selection is preserved — you need it to fix the problem.
      setFailure(result.failure)
      setConflicts(result.conflicts)
    } catch (error) {
      // A refusal is an answer; a thrown request is not. Without this the
      // button sits on "Merging…" for the rest of the session saying nothing.
      setFailure(toFailure(error))
    } finally {
      setMerging(false)
    }
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

  // Every table sits on its own. Saying so once beats a page of cards that all
  // refuse to be ticked.
  if (groups.every((group) => group.members.length < 2)) {
    return (
      <EmptyState
        title="No two tables in this batch share a shape"
        body="Combining is exact — same field names, same types. Every table here has a shape of its own, so there is nothing to put together."
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
          {/* Only with one shape on the page does "all" mean anything — across
              shapes it would tick every box and guarantee a refusal. Each
              card's own checkbox is the select-all that does make sense. */}
          {groups.length === 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => toggleGroup(everyId, selected.length !== everyId.length)}
              className="h-8 rounded-lg bg-card text-[12.5px]"
            >
              {selected.length === everyId.length ? "Select none" : "Select all"}
            </Button>
          )}
        </div>

        {groups.map((group) => (
          <MergeGroupCard
            key={group.shapeHash}
            group={group}
            selected={selected}
            closedReason={closedReason(group)}
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
