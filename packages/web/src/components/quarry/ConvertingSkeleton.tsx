import { cn } from "@/lib/utils"

/**
 * The converting screen before its first poll has answered — the one round trip
 * between pressing Convert and the server naming every table in the batch.
 *
 * It is the shape of the real screen rather than a spinner in the middle of an
 * empty page: the strip is where the strip will be and the rows are where the
 * rows will be, so the swap when the counts land moves nothing. It puts no
 * numbers on the stages, because it does not know any yet.
 */
export function ConvertingSkeleton() {
  return (
    <div
      role="status"
      aria-label="Reading the state of this batch"
      className="flex flex-col gap-6"
    >
      <div
        className="grid items-center gap-0"
        style={{ gridTemplateColumns: "1fr 44px 1fr 44px 1fr 44px 1fr" }}
      >
        {[0, 1, 2, 3].map((stage) => (
          <div key={stage} className="contents">
            {stage > 0 && <span aria-hidden className="mx-2 block h-px bg-border-faint" />}
            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border-faint bg-card px-3 py-2.5">
              <Bar className="h-[17px]" width={28} />
              <Bar className="h-[11.5px]" width={56} />
            </div>
          </div>
        ))}
      </div>

      <section className="flex flex-col">
        <div className="flex items-center justify-between gap-3 px-0.5 pb-2.5">
          <Bar className="h-[12.5px]" width={196} />
          <Bar className="h-8 rounded-lg" width={148} />
        </div>
        <div className="overflow-hidden rounded-xl border border-border-subtle">
          {ROWS.map((width, row) => (
            <div
              key={row}
              className="flex min-h-[56px] items-center gap-4 border-b border-border-faint bg-card px-4 py-2.5 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Bar className="h-[12.5px]" width={width} />
                <Bar className="h-[11.5px]" width={88} />
              </div>
              <Bar className="h-[12.5px] shrink-0" width={64} />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

/** Fixed widths, because a skeleton that reflows is a second wait. */
const ROWS = [164, 138, 182, 150]

function Bar({ className, width }: { className?: string; width?: number }) {
  return (
    <div
      aria-hidden
      style={width ? { width } : undefined}
      className={cn("rounded-md bg-muted motion-safe:animate-pulse", className)}
    />
  )
}
