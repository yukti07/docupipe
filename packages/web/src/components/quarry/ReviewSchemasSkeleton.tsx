import { cn } from "@/lib/utils"

/**
 * The review screen before it has anything to show — the route still arriving,
 * or the shapes still on their way back.
 *
 * It is the same shape as the real screen rather than a spinner in the middle
 * of an empty page, so the swap when the schemas land moves nothing: the cards
 * are already where the cards will be. It says nothing about *how many* of
 * anything there are, because it does not know yet, and a heading reading
 * "0 schemas to review" for half a second is worse than no heading at all.
 */
export function ReviewSchemasSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading the schemas in this batch"
      className="flex min-h-0 flex-1 overflow-hidden"
    >
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 px-6 py-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-2">
              <Bar className="h-[22px]" width={208} />
              <Bar className="h-[13px]" width={132} />
            </div>
            <div className="flex items-center gap-2">
              <Bar className="h-10 rounded-[10px]" width={124} />
              <Bar className="h-10 rounded-[10px]" width={156} />
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            {CARDS.map((chips, card) => (
              <section
                key={card}
                className="rounded-xl border border-border-subtle bg-card px-4 py-3.5"
              >
                <div className="flex items-start gap-3">
                  <Bar className="mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <Bar className="h-[15px]" width={104} />
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {chips.map((width, chip) => (
                        <Bar key={chip} className="h-[21px]" width={width} />
                      ))}
                    </div>
                  </div>
                  <Bar className="h-9 shrink-0 rounded-[10px]" width={122} />
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>

      {/* The panel opens itself on the real screen, so it is standing here too
          — below 1024px it is a sheet over the list and there is none to hold. */}
      <aside className="hidden w-[460px] shrink-0 flex-col border-l border-border-subtle bg-card lg:flex">
        <div className="border-b border-border-subtle px-4 py-3">
          <Bar className="h-[15px]" width={148} />
          <Bar className="mt-1.5 h-[12px]" width={196} />
        </div>

        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="overflow-hidden rounded-xl border border-border-subtle">
            {FIELDS.map((width, row) => (
              <div
                key={row}
                className="grid min-h-[44px] grid-cols-[1fr_112px] items-center gap-3 border-b border-border-faint px-3 py-2 last:border-b-0"
              >
                <Bar className="h-[13px]" width={width} />
                <Bar className="h-8 w-[112px] rounded-lg" />
              </div>
            ))}
          </div>
          <div aria-hidden className="h-9 rounded-[10px] border border-dashed border-border" />
        </div>

        <div className="flex items-center gap-2 border-t border-border-subtle px-4 py-3">
          <Bar className="h-9 flex-1 rounded-[10px]" />
          <Bar className="h-9 rounded-[10px]" width={70} />
        </div>
      </aside>
    </div>
  )
}

/** Chip widths per card. Fixed, because a skeleton that reflows is a new wait. */
const CARDS = [
  [96, 78, 64, 52, 46, 58],
  [88, 70, 74],
  [62, 92, 56, 68],
]

const FIELDS = [118, 96, 72, 44, 40, 58]

/**
 * One pulsing block. `motion-safe` because the pulse is decoration — under
 * reduced motion the block still holds the space it is standing in for.
 */
function Bar({ className, width }: { className?: string; width?: number }) {
  return (
    <div
      aria-hidden
      style={width ? { width } : undefined}
      className={cn("rounded-md bg-muted motion-safe:animate-pulse", className)}
    />
  )
}
