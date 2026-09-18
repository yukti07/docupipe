"use client"

import { ChevronLeft, Search } from "lucide-react"
import Link from "next/link"
import { use, useCallback, useEffect, useMemo, useState } from "react"
import { ErrorState } from "@/components/common/ErrorState"
import { SplitPane } from "@/components/common/SplitPane"
import { StatusBadge } from "@/components/common/StatusBadge"
import { Toolbar } from "@/components/common/Toolbar"
import { AppHeader } from "@/components/quarry/AppHeader"
import { DataTable } from "@/components/quarry/DataTable"
import { DensityToggle } from "@/components/quarry/DensityToggle"
import { DownloadTableButton } from "@/components/quarry/DownloadTableButton"
import { TableSkeleton } from "@/components/quarry/TableSkeleton"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import { readCachedTable, writeCachedTable } from "@/lib/cache"
import { sourceColumnFor } from "@/lib/csv"
import type { DensityOption } from "@/lib/density"
import { formatCount } from "@/lib/format"
import { ensureSession } from "@/lib/session"
import { useAsync } from "@/lib/useAsync"

export default function TablePage({
  params,
  searchParams,
}: PageProps<"/request/[requestId]/table/[schemaId]">) {
  const { requestId, schemaId } = use(params)
  // The batch screen's per-row Download links straight here with ?download=1,
  // because the rows it would write are the ones this screen has to fetch.
  const wanted = use(searchParams).download === "1"
  const [userId, setUserId] = useState<string | null>(null)

  const [search, setSearch] = useState("")
  const [density, setDensity] = useState<DensityOption>("comfortable")

  useEffect(() => {
    void ensureSession().then(setUserId)
  }, [])

  const {
    data: table,
    failure,
    reload,
  } = useAsync(
    `${requestId}:${schemaId}`,
    useCallback(async () => {
      // A table is only openable once its file has finished, and a finished
      // table's rows never change again. Opening the same one a second time —
      // to read it, then to download it — asks this browser, not the database.
      const cached = readCachedTable(requestId, schemaId)
      if (cached) return cached
      const fresh = await api.getTable(requestId, schemaId)
      writeCachedTable(requestId, schemaId, fresh)
      return fresh
    }, [requestId, schemaId]),
  )

  const markedValueIds = useMemo(
    () =>
      (table?.rows ?? []).flatMap((row) =>
        Object.values(row.values)
          .filter((value) => value.state === "marked")
          .map((value) => value.valueId),
      ),
    [table],
  )

  const failedRows = table?.rows.filter((row) => row.failed).length ?? 0

  return (
    <>
      <AppHeader userId={userId}>
        <p className="min-w-0 truncate font-mono text-[13px] font-medium">
          {table?.fileName ?? "Loading the table"}
        </p>
      </AppHeader>

      {/* The panel stays shut: the processing worker records no provenance for a
          value — no page, no box, nothing behind it — so there is nothing for
          Evidence to show. Cells render as plain text rather than as controls
          that open an empty drawer. `valueId` is still carried on every cell,
          so switching this back on is wiring, not a rewrite. */}
      <SplitPane
        className="flex-1"
        panelWidth={440}
        panelLabel="Evidence"
        onClose={() => {}}
        panel={null}
        list={
          <div className="flex w-full flex-col gap-4 px-6 py-5">
            {/* The counts arrive with the table; the way out is here from the
                first frame, because a screen you cannot leave while it loads
                is the one you most want to leave. */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {table && (
                  <>
                    <p className="text-[13px] tabular-nums text-subtle-foreground">
                      {formatCount(table.rows.length)} rows · {formatCount(table.fields.length)}{" "}
                      fields
                      {table.pageRange ? ` · pages ${table.pageRange}` : ""}
                    </p>
                    {markedValueIds.length > 0 && (
                      <StatusBadge variant="review">
                        {formatCount(markedValueIds.length)} to check
                      </StatusBadge>
                    )}
                    {failedRows > 0 && (
                      <StatusBadge variant="error">
                        {formatCount(failedRows)} {failedRows === 1 ? "row" : "rows"} failed
                      </StatusBadge>
                    )}
                  </>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  asChild
                  variant="outline"
                  className="h-9 gap-1.5 rounded-[10px] bg-card text-[13px]"
                >
                  <Link href={`/request/${requestId}`}>
                    <ChevronLeft aria-hidden className="size-4" />
                    Back to the batch
                  </Link>
                </Button>
                {table && <DownloadTableButton table={table} auto={wanted} />}
              </div>
            </div>

            {failure && (
              <ErrorState
                title="Couldn't open this table"
                body="The batch is still there. This one table didn't come back."
                onRetry={reload}
                backHref={`/request/${requestId}`}
              />
            )}

            {!table && !failure && <TableSkeleton />}

            {table && (
              <>
                <Toolbar label="Table controls" className="flex-wrap">
                  <div className="relative min-w-0 flex-1 sm:max-w-xs">
                    <Search
                      aria-hidden
                      className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      aria-label="Search this table"
                      placeholder="Search this table"
                      className="h-8 rounded-lg pl-8 text-[12.5px]"
                    />
                  </div>
                  <DensityToggle density={density} onChange={setDensity} />
                </Toolbar>

                <DataTable
                  fields={table.fields}
                  rows={table.rows}
                  density={density}
                  globalFilter={search}
                  onGlobalFilterChange={setSearch}
                  // A merged table's rows come from several tables, so the
                  // first column says which — the same column the CSV and the
                  // workbook carry.
                  sourceColumn={sourceColumnFor(table)}
                />
              </>
            )}
          </div>
        }
      />
    </>
  )
}
