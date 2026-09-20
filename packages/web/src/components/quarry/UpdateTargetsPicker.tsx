"use client"

import { ChevronLeft, Search } from "lucide-react"
import { useMemo, useState } from "react"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import type { Failure } from "@/lib/api/types"
import { formatCount } from "@/lib/format"
import type { UpdateTarget } from "@/lib/schema"
import { cn } from "@/lib/utils"

/**
 * The second page of the schema panel: which tables take this schema.
 *
 * It is a page rather than a popover because the list is the decision — on a
 * forty-file batch, choosing means reading forty names, and a menu that scrolls
 * inside a menu is not a place to read anything.
 *
 * The two headings carry the grouping. A table that matches exactly takes the
 * schema and nothing else happens to it; a table short of one field gains that
 * field, empty, and its row names the field before it is ever ticked.
 */
export function UpdateTargetsPicker({
  sourceName,
  sourceLabel,
  version,
  targets,
  updating,
  failure,
  onCancel,
  onConfirm,
  className,
}: {
  /** The table these fields come from, named at the top so the panel keeps its subject. */
  sourceName: string
  /**
   * The same table, named as the panel's dropdown names it. It heads the list
   * as a row that is ticked and cannot be unticked: the write always reaches
   * it, and a list that showed only the others would be a list of everywhere
   * this schema is going except the place it is going first.
   */
  sourceLabel?: string
  version: number
  targets: UpdateTarget[]
  updating?: boolean
  /** The write failed. It is shown here, where the selection that produced it still is. */
  failure?: Failure | null
  onCancel: () => void
  onConfirm: (schemaIds: string[]) => void
  className?: string
}) {
  const [chosen, setChosen] = useState<string[]>([])
  const [filter, setFilter] = useState("")

  const labels = useMemo(() => rowLabels(targets), [targets])

  const query = filter.trim().toLowerCase()
  const visible = query
    ? targets.filter((t) => labels.get(t.schema.schemaId)!.toLowerCase().includes(query))
    : targets

  const exact = visible.filter((t) => t.added.length === 0)
  const differs = visible.filter((t) => t.added.length > 0)

  // Select all sits beside the filter, so it means the filtered list. Ticking
  // names that something typed had pushed out of sight is the one thing this
  // page exists to prevent.
  const visibleIds = visible.map((t) => t.schema.schemaId)
  const allVisibleChosen = visibleIds.length > 0 && visibleIds.every((id) => chosen.includes(id))

  const toggle = (schemaId: string, next: boolean) =>
    setChosen((current) =>
      next ? [...new Set([...current, schemaId])] : current.filter((id) => id !== schemaId),
    )

  const toggleVisible = () =>
    setChosen((current) =>
      allVisibleChosen
        ? current.filter((id) => !visibleIds.includes(id))
        : [...new Set([...current, ...visibleIds])],
    )

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <header className="flex items-start gap-3 border-b border-border-subtle px-4 py-3">
        <Button
          variant="outline"
          size="icon"
          aria-label="Back to the schema"
          onClick={onCancel}
          className="size-8 shrink-0 rounded-lg bg-card"
        >
          <ChevronLeft aria-hidden className="size-4" />
        </Button>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium">Tables to update</p>
          <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
            <span className="font-mono">{sourceName}</span> · version {version}
          </p>
        </div>
      </header>

      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={filter}
            aria-label="Filter tables by name"
            placeholder="Filter tables"
            onChange={(e) => setFilter(e.target.value)}
            className="h-9 rounded-[10px] pl-8 text-[12.5px]"
          />
        </div>
        <Button
          variant="ghost"
          disabled={visibleIds.length === 0}
          onClick={toggleVisible}
          className="h-9 shrink-0 rounded-[10px] px-2 text-[12.5px] font-medium"
        >
          {allVisibleChosen ? "Select none" : "Select all"}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {sourceLabel && (
          <section>
            <h3 className="px-4 pt-3.5 pb-1.5 text-[10.5px] font-semibold tracking-[0.08em] uppercase text-muted-foreground">
              This table
            </h3>
            {/* Not filtered and not toggleable — it is not a choice, it is
                what the button already does. */}
            <div className="flex items-center gap-3 px-4 py-2.5">
              <Checkbox checked disabled aria-label={`${sourceLabel} — always updated`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12.5px]">{sourceLabel}</span>
                <span className="block truncate text-[11.5px] text-muted-foreground">
                  always updated
                </span>
              </span>
            </div>
          </section>
        )}

        {visible.length === 0 && targets.length > 0 && (
          <p className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">
            No table here is called that.
          </p>
        )}

        <Bucket
          title="Exact same fields"
          tone="plain"
          targets={exact}
          labels={labels}
          chosen={chosen}
          disabled={updating}
          onToggle={toggle}
        />
        <Bucket
          title="One field differs"
          tone="differs"
          targets={differs}
          labels={labels}
          chosen={chosen}
          disabled={updating}
          onToggle={toggle}
        />
      </div>

      <footer className="flex flex-col gap-2.5 border-t border-border-subtle px-4 py-3">
        {failure && <FailureMessage failure={failure} />}

        <div className="flex items-center justify-between gap-3">
        {/* Counted with the table on screen, which is always one of them. */}
        <p className="text-[12px] tabular-nums text-muted-foreground">
          {formatCount(chosen.length + 1)} of {formatCount(targets.length + 1)} chosen
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={updating}
            onClick={onCancel}
            className="h-9 rounded-[10px] bg-card text-[12.5px]"
          >
            Cancel
          </Button>
          {/* Never dead: with nothing else ticked this writes the table on
              screen, which is the one thing it was always going to do. */}
          <Button
            disabled={updating}
            onClick={() => onConfirm(chosen)}
            className="h-9 rounded-[10px] text-[12.5px]"
          >
            {updating
              ? "Updating…"
              : `Update ${formatCount(chosen.length + 1)} ${
                  chosen.length === 0 ? "table" : "tables"
                }`}
          </Button>
        </div>
        </div>
      </footer>
    </div>
  )
}

function Bucket({
  title,
  tone,
  targets,
  labels,
  chosen,
  disabled,
  onToggle,
}: {
  title: string
  tone: "plain" | "differs"
  targets: UpdateTarget[]
  labels: Map<string, string>
  chosen: string[]
  disabled?: boolean
  onToggle: (schemaId: string, next: boolean) => void
}) {
  if (targets.length === 0) return null

  return (
    <section>
      <h3
        className={cn(
          "px-4 pt-3.5 pb-1.5 text-[10.5px] font-semibold tracking-[0.08em] tabular-nums uppercase",
          tone === "differs" ? "text-review-strong" : "text-muted-foreground",
        )}
      >
        {title} · {formatCount(targets.length)}
      </h3>
      <ul>
        {targets.map((target) => {
          const id = target.schema.schemaId
          const checked = chosen.includes(id)
          return (
            <li key={id}>
              {/* The whole row toggles — a 16px box on a 460px row is a miss
                  waiting to happen — and the box itself stays the control, so
                  the keyboard and the accessible name both go through it. */}
              <div
                onClick={() => !disabled && onToggle(id, !checked)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-muted",
                  disabled && "cursor-not-allowed opacity-60",
                )}
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  aria-label={labels.get(id)}
                  onClick={(e) => e.stopPropagation()}
                  onCheckedChange={(next) => onToggle(id, next === true)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[12.5px]">{labels.get(id)}</span>
                  {target.added.length > 0 && (
                    <span className="block truncate text-[11.5px] text-muted-foreground">
                      no {target.added[0]} — it will be added empty
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                  {formatCount(target.schema.current.length)} fields
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * The file name, and the table inside it only when the name alone would appear
 * twice. A file that held one table is its own row; a file that held ten needs
 * ten rows that can be told apart.
 */
function rowLabels(targets: UpdateTarget[]): Map<string, string> {
  const seen = new Map<string, number>()
  for (const { schema } of targets) {
    seen.set(schema.fileName, (seen.get(schema.fileName) ?? 0) + 1)
  }
  return new Map(
    targets.map(({ schema }) => [
      schema.schemaId,
      seen.get(schema.fileName)! > 1 ? `${schema.fileName} · ${schema.tableLabel}` : schema.fileName,
    ]),
  )
}
