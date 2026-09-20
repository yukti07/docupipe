"use client"

import {
  columnFilteringFeature,
  columnOrderingFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ArrowDown, ArrowUp, ChevronsUpDown, GripVertical } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { ActiveFilters, ColumnFilter } from "@/components/quarry/ColumnFilter"
import { DataCell } from "@/components/quarry/DataCell"
import { FIELD_TYPE_LABELS } from "@/components/quarry/FieldTypeSelect"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import type { CellValue, FieldType, SchemaField, TableRow } from "@/lib/api/types"
import { measureColumns, type ColumnSpec } from "@/lib/colwidth"
import { fieldHeader } from "@/lib/schema"
import {
  CELL_PADDING,
  CELL_TEXT,
  HEADER_PADDING,
  ROW_HEIGHT,
  type DensityOption,
} from "@/lib/density"
import {
  OPERATOR_LABELS,
  type ColumnFilterValue,
  describeOperand,
  isApplied,
  matches,
  unreadable,
} from "@/lib/filters"
import { cn } from "@/lib/utils"

/* v9 registers features and row models explicitly; there is no useReactTable
   and no getCoreRowModel(). Held at module scope so the models are not
   invalidated on every render. */
const features = tableFeatures({
  columnFilteringFeature,
  columnOrderingFeature,
  globalFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: { includesString: filterFn_includesString },
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
})

const helper = createColumnHelper<typeof features, TableRow>()

/** The merged-table column that is not a schema field. */
const SOURCE_ID = "__source"

/** Past this many rows the body is windowed rather than all mounted. */
export const VIRTUALIZE_ABOVE = 100

export type DataTableProps = {
  fields: SchemaField[]
  rows: TableRow[]
  loading?: boolean
  density?: DensityOption
  globalFilter?: string
  onGlobalFilterChange?: (value: string) => void
  selectedValueId?: string | null
  onOpenEvidence?: (valueId: string) => void
  /** A merged table adds one column and is otherwise this same table. */
  sourceColumn?: { header: string; value: (row: TableRow) => string }
  className?: string
}

export function DataTable({
  fields,
  rows,
  loading,
  density = "comfortable",
  globalFilter = "",
  onGlobalFilterChange,
  selectedValueId,
  onOpenEvidence,
  sourceColumn,
  className,
}: DataTableProps) {
  const columns = useMemo(() => {
    const sourceColumns = sourceColumn
      ? [
          helper.accessor((row) => sourceColumn.value(row), {
            id: SOURCE_ID,
            header: sourceColumn.header,
            sortFn: "text",
            // Not a schema field, so it has no declared type — it is filtered
            // as the text it is, read off the row rather than out of `values`.
            filterFn: (row, _id, filter) =>
              matches(
                "text",
                asCell(sourceColumn.value(row.original)),
                filter as ColumnFilterValue,
              ),
            cell: (context) => (
              <div
                className={cn(
                  "truncate font-mono text-subtle-foreground",
                  CELL_TEXT[density],
                  CELL_PADDING[density],
                )}
              >
                {context.getValue() as string}
              </div>
            ),
          }),
        ]
      : []

    return helper.columns([
      ...sourceColumns,
      ...fields.map((field) =>
        helper.accessor((row) => row.values[field.key]?.display ?? "", {
          id: field.key,
          header: fieldHeader(field),
          // The column's own type decides what its filter may ask and how its
          // cells are read, so the predicate closes over the field rather than
          // being looked up by name in a shared registry.
          //
          // A failed row is passed as no value at all: it carries whatever the
          // worker managed before giving up, but every cell in it renders "not
          // found", and a filter reading the hidden figure would disagree with
          // the screen.
          filterFn: (row, _id, filter) =>
            matches(
              field.type,
              row.original.failed ? undefined : row.original.values[field.key],
              filter as ColumnFilterValue,
            ),
          sortFn: field.type === "date" ? "datetime" : field.type === "text" ? "text" : "alphanumeric",
          cell: (context) => {
            const row = context.row.original
            return (
              <DataCell
                value={row.values[field.key]}
                failedRow={Boolean(row.failed)}
                selected={selectedValueId === row.values[field.key]?.valueId}
                density={density}
                align={isNumeric(field.type) ? "right" : "left"}
                onOpenEvidence={onOpenEvidence}
              />
            )
          },
        }),
      ),
    ])
  }, [density, fields, onOpenEvidence, selectedValueId, sourceColumn])

  // Per-column filters are the table's own state: nothing outside it needs to
  // read them, and the search box above is the one filter a screen does drive.
  const [columnFilters, setColumnFilters] = useState<{ id: string; value: ColumnFilterValue }[]>(
    [],
  )

  /** What each column's filter should offer. The source column has no field. */
  const typeOf = useMemo(() => {
    const types = new Map<string, FieldType>(fields.map((field) => [field.key, field.type]))
    return (id: string): FieldType => types.get(id) ?? "text"
  }, [fields])

  /* A field column's id is its key, but its header is not: a currency column
     is named with the currency it is in. The source column's id is neither —
     it is `__source`, and naming a control after that puts an internal id in
     front of whoever is reading the label out. */
  const headers = useMemo(
    () => new Map(fields.map((field) => [field.key, fieldHeader(field)])),
    [fields],
  )
  const labelOf = (id: string) =>
    id === SOURCE_ID ? (sourceColumn?.header ?? id) : (headers.get(id) ?? id)

  /** Every column in the order the table was given them. */
  const naturalOrder = useMemo(
    () => (sourceColumn ? [SOURCE_ID, ...fields.map((f) => f.key)] : fields.map((f) => f.key)),
    [fields, sourceColumn],
  )

  // Dragged order, kept for as long as the table is on screen. It is a way of
  // reading this table, not a property of it, so it is not persisted — and a
  // table whose fields change is put back in the order the schema gives.
  const [columnOrder, setColumnOrder] = useState<string[]>(naturalOrder)
  useEffect(() => setColumnOrder(naturalOrder), [naturalOrder])

  /* Measured once per table, from the header and a sample of the rows, because
     the body is windowed: letting the browser size the columns would re-size
     the whole grid every time new rows scrolled into it. */
  const widths = useMemo(() => {
    const specs: ColumnSpec[] = [
      ...(sourceColumn
        ? [
            {
              id: SOURCE_ID,
              header: sourceColumn.header,
              type: "text" as FieldType,
              read: sourceColumn.value,
            },
          ]
        : []),
      ...fields.map((field) => ({
        id: field.key,
        header: fieldHeader(field),
        type: field.type,
        badge: FIELD_TYPE_LABELS[field.type],
      })),
    ]
    return measureColumns(specs, rows, { density })
  }, [density, fields, rows, sourceColumn])

  const table = useTable({
    features,
    columns,
    data: rows,
    state: { globalFilter, columnFilters, columnOrder },
    onColumnOrderChange: (updater) =>
      setColumnOrder((current) => (typeof updater === "function" ? updater(current) : updater)),
    onColumnFiltersChange: (updater) =>
      setColumnFilters(
        (current) =>
          (typeof updater === "function"
            ? updater(current)
            : updater) as { id: string; value: ColumnFilterValue }[],
      ),
    onGlobalFilterChange: (updater) => {
      const next = typeof updater === "function" ? updater(globalFilter) : updater
      onGlobalFilterChange?.(String(next ?? ""))
    },
  })

  /** Only the ones narrowing anything — a half-typed one is not yet a filter. */
  const active = columnFilters
    .filter((filter) => isApplied(filter.value))
    .map((filter) => ({
      id: filter.id,
      label: labelOf(filter.id),
      operator: OPERATOR_LABELS[filter.value.op],
      operand: describeOperand(filter.value),
    }))

  const setFilter = (id: string, value: ColumnFilterValue | undefined) =>
    setColumnFilters((current) => {
      const rest = current.filter((filter) => filter.id !== id)
      return value === undefined || !isApplied(value) ? rest : [...rest, { id, value }]
    })

  /** Puts `id` where `before` sits now, sliding the rest along. */
  const moveColumn = (id: string, to: number) =>
    setColumnOrder((current) => {
      const from = current.indexOf(id)
      if (from < 0 || to < 0 || to >= current.length || from === to) return current
      const next = [...current]
      next.splice(to, 0, next.splice(from, 1)[0])
      return next
    })

  const modelRows = table.getRowModel().rows
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualize = modelRows.length > VIRTUALIZE_ABOVE
  const rowHeight = ROW_HEIGHT[density]

  const virtualizer = useVirtualizer({
    count: modelRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => modelRows[index].id,
    overscan: 12,
    enabled: virtualize,
  })

  if (loading) {
    return (
      <div className={cn("rounded-xl border border-border-subtle bg-card", className)}>
        <div className="flex flex-col gap-2 p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-8 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className={cn("rounded-xl border border-border-subtle bg-card", className)}>
        <EmptyState
          title="This file produced no rows"
          body="It was read, but nothing table-shaped came out of it."
        />
      </div>
    )
  }

  if (modelRows.length === 0) {
    // Whichever of the two is responsible is named. Blaming the search box for
    // a column filter leaves someone clearing a search that was already empty.
    const searching = globalFilter.trim() !== ""
    return (
      <div className="flex flex-col gap-3">
        <ActiveFilters
          filters={active}
          onRemove={(id) => setFilter(id, undefined)}
          onClearAll={() => setColumnFilters([])}
        />
        <div className={cn("rounded-xl border border-border-subtle bg-card", className)}>
          <EmptyState
            title={active.length > 0 ? "No rows match" : "No rows match your search"}
            body={
              searching && active.length > 0
                ? `Nothing contains “${globalFilter}” and passes the ${active.length === 1 ? "column filter" : "column filters"} above. Clear one of them to see more of the ${rows.length} rows.`
                : active.length > 0
                  ? `No row passes the ${active.length === 1 ? "filter" : "filters"} above. Clear ${active.length === 1 ? "it" : "one of them"} to see more of the ${rows.length} rows.`
                  : `Nothing in this table contains “${globalFilter}”. Clear the search to see all ${rows.length} rows.`
            }
          />
        </div>
      </div>
    )
  }

  const virtualItems = virtualizer.getVirtualItems()
  const paddingTop = virtualize && virtualItems.length > 0 ? virtualItems[0].start : 0
  const paddingBottom =
    virtualize && virtualItems.length > 0
      ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0
  const visible = virtualize ? virtualItems.map((item) => modelRows[item.index]) : modelRows
  const leafColumns = table.getAllLeafColumns()
  // What the measured columns add up to. Below it the table scrolls sideways
  // rather than squeezing every column past the width it was measured for —
  // `table-fixed` treats widths that do not fill the box as proportions, which
  // would silently undo the measurement on any table wide enough to need it.
  const totalWidth = leafColumns.reduce((sum, column) => sum + (widths.get(column.id) ?? 0), 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ActiveFilters
        filters={active}
        onRemove={(id) => setFilter(id, undefined)}
        onClearAll={() => setColumnFilters([])}
      />

      {/* The table takes whatever height its container has left and scrolls
          inside it, so the sticky header stays put and the footer below never
          moves. The screen bounds it; this used to guess with a viewport
          calculation, which was wrong by however tall the toolbar was. */}
      <div
        ref={scrollRef}
        className={cn(
          "min-h-0 flex-1 overflow-auto rounded-xl border border-border-subtle bg-card",
          className,
        )}
      >
      {/* Rules, not stripes: stripes fight the cell state colours. Fixed
          layout, because the widths below were measured for it — with `auto`
          the browser would re-derive them from whichever rows are mounted. */}
      <table
        style={{ minWidth: totalWidth }}
        className="w-full table-fixed border-collapse text-[13px]"
      >
        {/* Every column keeps the width it was measured for; the last column
            has none, so fixed layout hands it whatever is left over. Without
            it the slack is shared out across the real columns and a five-column
            table on a wide screen puts each header's filter button half a
            screen away from the name it belongs to. */}
        <colgroup>
          {leafColumns.map((column) => (
            <col key={column.id} style={{ width: widths.get(column.id) }} />
          ))}
          <col />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-card">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="border-b border-border-subtle">
              {group.headers.map((header, index) => {
                const sorted = header.column.getIsSorted()
                const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ChevronsUpDown
                const id = header.column.id
                const type = typeOf(id)
                const numeric = isNumeric(type)
                const filter = columnFilters.find((entry) => entry.id === id)?.value
                return (
                  <th
                    key={header.id}
                    scope="col"
                    data-column={id}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault()
                      const dragged = event.dataTransfer.getData("text/x-quarry-column")
                      if (dragged) moveColumn(dragged, index)
                    }}
                    className="group/th p-0 text-left"
                  >
                    <div className={cn("flex w-full items-center gap-1", HEADER_PADDING[density])}>
                      <ColumnGrip
                        label={labelOf(id)}
                        index={index}
                        count={leafColumns.length}
                        onMove={(to) => moveColumn(id, to)}
                        columnId={id}
                      />
                      <button
                        type="button"
                        onClick={() => header.column.toggleSorting()}
                        aria-label={`Sort by ${labelOf(id)}`}
                        className={cn(
                          "-mx-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 font-mono text-[11.5px] font-medium text-subtle-foreground hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                          numeric && "justify-end",
                        )}
                      >
                        <span className="truncate">
                          {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                        </span>
                        {/* What the schema says this column holds, said on the
                            column itself. Dropped on compact, where the row has
                            no room for a second thing to read. */}
                        {id !== SOURCE_ID && density === "comfortable" && (
                          <span className="shrink-0 rounded border border-border-subtle px-1 text-[9.5px] font-normal uppercase tracking-[0.04em] text-muted-foreground">
                            {FIELD_TYPE_LABELS[type]}
                          </span>
                        )}
                        {/* The indicator stays visible on the sorted column, not only on hover. */}
                        <Icon
                          aria-hidden
                          className={cn(
                            "size-3 shrink-0",
                            sorted ? "text-foreground" : "text-muted-foreground/60",
                          )}
                        />
                      </button>
                      <ColumnFilter
                        column={labelOf(id)}
                        type={type}
                        value={filter}
                        rows={rows.length}
                        unreadable={() => unreadable(type, rows, id)}
                        onChange={(value) => setFilter(id, value)}
                      />
                    </div>
                  </th>
                )
              })}
              <th aria-hidden className="p-0" />
            </tr>
          ))}
        </thead>

        <tbody>
          {paddingTop > 0 && (
            <tr aria-hidden>
              <td colSpan={columns.length + 1} style={{ height: paddingTop }} />
            </tr>
          )}

          {visible.map((row) => (
            <tr
              key={row.id}
              data-failed={row.original.failed ? "" : undefined}
              className={cn(
                "border-b border-border-faint last:border-b-0",
                row.original.failed && "bg-muted/60",
              )}
            >
              {row.getAllCells().map((cell) => (
                <td key={cell.id} className="p-0 align-top">
                  <table.FlexRender cell={cell} />
                </td>
              ))}
              <td aria-hidden className="p-0" />
            </tr>
          ))}

          {paddingBottom > 0 && (
            <tr aria-hidden>
              <td colSpan={columns.length + 1} style={{ height: paddingBottom }} />
            </tr>
          )}
        </tbody>
      </table>

        {rows.some((row) => row.failed) && (
          <div className="border-t border-border-subtle p-3">
            <FailureMessage
              compact
              failure={rows.find((row) => row.failed)!.failed ?? { class: "unknown" }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The handle that moves a column.
 *
 * Dragging is the obvious gesture and the arrow keys are the one that works
 * without a mouse, so the handle answers to both. It is a real button rather
 * than a draggable header, because a header that both sorts and drags on the
 * same press can only reliably do one of them — and sorting is what people
 * reach for by habit.
 */
function ColumnGrip({
  columnId,
  label,
  index,
  count,
  onMove,
}: {
  columnId: string
  label: string
  index: number
  count: number
  onMove: (to: number) => void
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData("text/x-quarry-column", columnId)
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
        // The arrows would otherwise scroll the table sideways under the
        // column being moved.
        event.preventDefault()
        onMove(index + (event.key === "ArrowLeft" ? -1 : 1))
      }}
      aria-label={`Move ${label} — column ${index + 1} of ${count}`}
      className="-ml-1 flex size-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/0 transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring group-hover/th:text-muted-foreground/60 active:cursor-grabbing"
    >
      <GripVertical aria-hidden className="size-3" strokeWidth={2} />
    </button>
  )
}

/** Figures read right; everything else reads left. */
function isNumeric(type: FieldType): boolean {
  return type === "number" || type === "currency"
}

/** The source column is a string on the row, not a cell — this lends it one. */
function asCell(display: string): CellValue {
  return { valueId: "", display, state: "value" }
}
