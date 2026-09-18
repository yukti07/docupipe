"use client"

import {
  columnFilteringFeature,
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
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"
import { useMemo, useRef } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { DataCell } from "@/components/quarry/DataCell"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import type { SchemaField, TableRow } from "@/lib/api/types"
import { CELL_PADDING, HEADER_PADDING, ROW_HEIGHT, type DensityOption } from "@/lib/density"
import { cn } from "@/lib/utils"

/* v9 registers features and row models explicitly; there is no useReactTable
   and no getCoreRowModel(). Held at module scope so the models are not
   invalidated on every render. */
const features = tableFeatures({
  columnFilteringFeature,
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
            id: "__source",
            header: sourceColumn.header,
            sortFn: "text",
            cell: (context) => (
              <div
                className={cn(
                  "truncate font-mono text-[12px] text-subtle-foreground",
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
          header: field.key,
          filterFn: "includesString",
          sortFn: field.type === "date" ? "datetime" : field.type === "text" ? "text" : "alphanumeric",
          cell: (context) => {
            const row = context.row.original
            return (
              <DataCell
                value={row.values[field.key]}
                failedRow={Boolean(row.failed)}
                selected={selectedValueId === row.values[field.key]?.valueId}
                density={density}
                onOpenEvidence={onOpenEvidence}
              />
            )
          },
        }),
      ),
    ])
  }, [density, fields, onOpenEvidence, selectedValueId, sourceColumn])

  const table = useTable({
    features,
    columns,
    data: rows,
    state: { globalFilter },
    onGlobalFilterChange: (updater) => {
      const next = typeof updater === "function" ? updater(globalFilter) : updater
      onGlobalFilterChange?.(String(next ?? ""))
    },
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
    return (
      <div className={cn("rounded-xl border border-border-subtle bg-card", className)}>
        <EmptyState
          title="No rows match your search"
          body={`Nothing in this table contains “${globalFilter}”. Clear the search to see all ${rows.length} rows.`}
        />
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

  return (
    <div
      ref={scrollRef}
      className={cn(
        "max-h-[calc(100vh-260px)] overflow-auto rounded-xl border border-border-subtle bg-card",
        className,
      )}
    >
      {/* Rules, not stripes: stripes fight the cell state colours. */}
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-card">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="border-b border-border-subtle">
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted()
                const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ChevronsUpDown
                return (
                  <th key={header.id} scope="col" className="p-0 text-left">
                    <button
                      type="button"
                      onClick={() => header.column.toggleSorting()}
                      aria-label={`Sort by ${header.column.id}`}
                      className={cn(
                        "flex w-full items-center gap-1.5 font-mono text-[11.5px] font-medium text-subtle-foreground hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                        HEADER_PADDING[density],
                      )}
                    >
                      {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                      {/* The indicator stays visible on the sorted column, not only on hover. */}
                      <Icon
                        aria-hidden
                        className={cn("size-3", sorted ? "text-foreground" : "text-muted-foreground/60")}
                      />
                    </button>
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>

        <tbody>
          {paddingTop > 0 && (
            <tr aria-hidden>
              <td colSpan={columns.length} style={{ height: paddingTop }} />
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
            </tr>
          ))}

          {paddingBottom > 0 && (
            <tr aria-hidden>
              <td colSpan={columns.length} style={{ height: paddingBottom }} />
            </tr>
          )}
        </tbody>
      </table>

      {rows.some((row) => row.failed) && (
        <div className="border-t border-border-subtle p-3">
          <FailureMessage
            compact
            failure={
              rows.find((row) => row.failed)!.failed ?? { class: "unknown" }
            }
          />
        </div>
      )}
    </div>
  )
}
