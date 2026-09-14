"use client"

import { Search } from "lucide-react"
import Link from "next/link"
import { use, useCallback, useEffect, useMemo, useState } from "react"
import { ErrorState } from "@/components/common/ErrorState"
import { LoadingState } from "@/components/common/LoadingState"
import { SplitPane } from "@/components/common/SplitPane"
import { StatusBadge } from "@/components/common/StatusBadge"
import { Toolbar } from "@/components/common/Toolbar"
import { AppHeader } from "@/components/quarry/AppHeader"
import { DataTable, type DensityOption } from "@/components/quarry/DataTable"
import { DensityToggle } from "@/components/quarry/DensityToggle"
import { DownloadTableButton } from "@/components/quarry/DownloadTableButton"
import { EvidencePanel } from "@/components/quarry/EvidencePanel"
import { MarkedCellNav } from "@/components/quarry/MarkedCellNav"
import { RawTextView } from "@/components/quarry/RawTextView"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/lib/api"
import { formatCount } from "@/lib/format"
import { ensureSession } from "@/lib/session"
import { useAsync } from "@/lib/useAsync"

export default function TablePage({ params }: PageProps<"/b/[requestId]/t/[schemaId]">) {
  const { requestId, schemaId } = use(params)
  const [userId, setUserId] = useState<string | null>(null)

  const [view, setView] = useState<"table" | "raw">("table")
  const [search, setSearch] = useState("")
  const [density, setDensity] = useState<DensityOption>("comfortable")
  const [openValueId, setOpenValueId] = useState<string | null>(null)

  useEffect(() => {
    void ensureSession().then(setUserId)
  }, [])

  const {
    data: table,
    failure,
    reload,
  } = useAsync(
    `${requestId}:${schemaId}`,
    useCallback(() => api.getTable(requestId, schemaId), [requestId, schemaId]),
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
        <div className="min-w-0">
          <p className="truncate text-[12px] text-muted-foreground">
            <Link href={`/b/${requestId}`} className="hover:underline">
              Back to the batch
            </Link>
          </p>
          <p className="truncate font-mono text-[13px] font-medium">
            {table?.fileName ?? "Loading the table"}
          </p>
        </div>
      </AppHeader>

      <SplitPane
        className="flex-1"
        panelWidth={440}
        panelLabel="Evidence"
        onClose={() => setOpenValueId(null)}
        panel={
          openValueId && table ? (
            <EvidencePanel
              valueId={openValueId}
              fileName={table.fileName}
              onClose={() => setOpenValueId(null)}
            />
          ) : null
        }
        list={
          <div className="flex w-full flex-col gap-4 px-6 py-5">
            {failure && (
              <ErrorState
                title="Couldn't open this table"
                body="The batch is still there. This one table didn't come back."
                onRetry={reload}
                backHref={`/b/${requestId}`}
              />
            )}

            {!table && !failure && <LoadingState label="Loading this table" />}

            {table && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
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
                  </div>
                  <DownloadTableButton table={table} />
                </div>

                <Tabs value={view} onValueChange={(next) => setView(next as "table" | "raw")}>
                  <TabsList>
                    <TabsTrigger value="table">Table</TabsTrigger>
                    <TabsTrigger value="raw">Raw text</TabsTrigger>
                  </TabsList>
                </Tabs>

                {view === "table" ? (
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
                      {/* Stepping through marked cells moves the panel with the selection. */}
                      <MarkedCellNav
                        valueIds={markedValueIds}
                        currentValueId={openValueId}
                        onSelect={setOpenValueId}
                      />
                      <DensityToggle density={density} onChange={setDensity} />
                    </Toolbar>

                    <DataTable
                      fields={table.fields}
                      rows={table.rows}
                      density={density}
                      globalFilter={search}
                      onGlobalFilterChange={setSearch}
                      selectedValueId={openValueId}
                      onOpenEvidence={setOpenValueId}
                    />
                  </>
                ) : (
                  <RawTextView requestId={requestId} schemaId={schemaId} />
                )}
              </>
            )}
          </div>
        }
      />
    </>
  )
}
