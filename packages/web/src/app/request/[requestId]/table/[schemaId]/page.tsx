"use client"

import { Search } from "lucide-react"
import { use, useCallback, useEffect, useMemo, useState } from "react"
import { BatchFooter } from "@/components/common/BatchFooter"
import { BatchShell } from "@/components/common/BatchShell"
import { ErrorState } from "@/components/common/ErrorState"
import { StatusBadge } from "@/components/common/StatusBadge"
import { Toolbar } from "@/components/common/Toolbar"
import { railPhase } from "@/components/quarry/BatchNav"
import { DataTable } from "@/components/quarry/DataTable"
import { DensityToggle } from "@/components/quarry/DensityToggle"
import { DownloadTableButton } from "@/components/quarry/DownloadTableButton"
import { TableSkeleton } from "@/components/quarry/TableSkeleton"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import { readCachedTable, writeCachedTable } from "@/lib/cache"
import { sourceColumnFor } from "@/lib/csv"
import type { DensityOption } from "@/lib/density"
import { formatCount } from "@/lib/format"
import { ensureSession } from "@/lib/session"
import { useAsync } from "@/lib/useAsync"
import { useWorkspace } from "@/state/workspace"

export default function TablePage({
  params,
  searchParams,
}: PageProps<"/request/[requestId]/table/[schemaId]">) {
  const { requestId, schemaId } = use(params)
  // The batch screen's per-row Download links straight here with ?download=1,
  // because the rows it would write are the ones this screen has to fetch.
  const wanted = use(searchParams).download === "1"
  const { batches } = useWorkspace()

  const [search, setSearch] = useState("")
  const [density, setDensity] = useState<DensityOption>("comfortable")

  // Nothing on this screen is addressed to a user, but the table request still
  // has to arrive on a browser the server knows about.
  useEffect(() => {
    void ensureSession()
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
    <BatchShell
      requestId={requestId}
      current="results"
      done={{ files: true, schemas: true }}
      // A table only exists on the far side of the gate, so the batch has
      // converted whether or not this browser watched it happen.
      phase={railPhase(batches.find((b) => b.requestId === requestId)?.phase ?? "done")}
      // The filename hangs off Results rather than standing alone, which is
      // what gives this screen a way back to the batch it belongs to. Until it
      // is known the rail says so instead — a state, in the rail's own voice —
      // and a table that never opened has no name to put here at all, so the
      // tail goes rather than sitting over the error saying it is still coming.
      tail={
        table ? (
          <span className="font-mono">{table.fileName}</span>
        ) : failure ? undefined : (
          "Loading the table…"
        )
      }
      footer={
        // No Back: the rail's Results step is the way out, and a second one
        // beside Download would only be a second thing to read.
        <BatchFooter
          status={
            table ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[13px] tabular-nums text-subtle-foreground">
                  {formatCount(table.rows.length)} rows · {formatCount(table.fields.length)} fields
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
              </div>
            ) : undefined
          }
          actions={table ? <DownloadTableButton table={table} auto={wanted} /> : undefined}
        />
      }
    >
      {/* The evidence panel stays shut: the processing worker records no
          provenance for a value — no page, no box, nothing behind it — so there
          is nothing for it to show. Cells render as plain text rather than as
          controls that open an empty drawer. `valueId` is still carried on every
          cell, so switching this back on is wiring, not a rewrite. */}
      <div className="flex h-full min-h-0 w-full flex-col gap-4 px-6 py-5">
        {failure && (
          <ErrorState
            title="Couldn't open this table"
            body="The batch is still there. This one table didn't come back."
            onRetry={reload}
            // Named for where it goes. The rail's tail is gone in this state —
            // there is no table to name — so this is the way back out.
            backHref={`/request/${requestId}`}
            backLabel="Back to the batch"
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
    </BatchShell>
  )
}
