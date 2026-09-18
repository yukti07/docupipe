import { cn } from "@/lib/utils"

/**
 * The table screen before its rows arrive — one database round trip, whether it
 * was opened to be read or to be downloaded.
 *
 * It stands in the shape of the real screen rather than replacing it with a
 * spinner, so the way out, the counts and the controls stay where they are and
 * the rows drop into a grid that is already there.
 */
export function TableSkeleton() {
  return (
    <div role="status" aria-label="Loading this table" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-subtle bg-card px-3 py-2">
        <Bar className="h-8 flex-1 rounded-lg sm:max-w-xs" />
        <Bar className="h-8 rounded-lg" width={168} />
      </div>

      <div className="overflow-hidden rounded-xl border border-border-subtle bg-card">
        <div className="flex gap-3 border-b border-border-subtle px-3 py-2.5">
          {COLUMNS.map((width, column) => (
            <Bar key={column} className="h-[11.5px]" width={width} />
          ))}
        </div>
        {Array.from({ length: 8 }, (_, row) => (
          <div key={row} className="flex gap-3 border-b border-border-faint px-3 py-2 last:border-b-0">
            {COLUMNS.map((width, column) => (
              <Bar key={column} className="h-[13px]" width={width} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Fixed widths, because a skeleton that reflows is a second wait. */
const COLUMNS = [116, 92, 148, 76, 104]

function Bar({ className, width }: { className?: string; width?: number }) {
  return (
    <div
      aria-hidden
      style={width ? { width } : undefined}
      className={cn("rounded-md bg-muted motion-safe:animate-pulse", className)}
    />
  )
}
