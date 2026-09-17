"use client"

import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatCount } from "@/lib/format"
import { cn } from "@/lib/utils"

/** What this file's schema is doing, which is the only thing this button can mean. */
export type SchemaEditState = "uploading" | "loading" | "stalled" | "ready" | "none"

/**
 * One button per file, never one per table — a file that held ten tables is
 * still one file, and opening it opens all ten in the panel.
 *
 * The button fills while its schema is being read: an indeterminate ease that
 * stops short of full, so the fill completing means the schema actually landed
 * rather than a timer running out. It stays filled afterwards.
 */
export function SchemaEditButton({
  state,
  tableCount = 0,
  noShapeReason,
  onOpen,
  className,
}: {
  state: SchemaEditState
  tableCount?: number
  /** Why there is nothing to open — the row's own reason, not a guess. */
  noShapeReason?: string
  onOpen: () => void
  className?: string
}) {
  const label = tooltipFor(state, tableCount, noShapeReason)
  const ready = state === "ready"

  return (
    <Tooltip>
      {/* The trigger is the wrapper, not the button: a disabled button takes no
          pointer events, and the states that most need explaining are disabled. */}
      <TooltipTrigger asChild>
        <span className={cn("inline-flex", className)}>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!ready}
            aria-label={label}
            onClick={onOpen}
            data-schema={state}
            className={cn(
              "relative size-9 shrink-0 overflow-hidden rounded-[10px] bg-card disabled:opacity-100",
              ready && "border-primary-tint-border",
            )}
          >
            {(state === "loading" || state === "stalled" || ready) && (
              <span
                aria-hidden
                data-water
                className={cn(
                  "absolute inset-x-0 bottom-0 transition-[height] duration-700 ease-out",
                  ready ? "h-full bg-water-deep" : "h-1/2 bg-water",
                )}
              >
                {/* The surface: two crests riding the waterline, one drifting
                    each way. Both are darker than the body they sit on, or
                    there is nothing to see at 36 pixels. */}
                <span
                  className={cn(
                    "absolute inset-x-0 -top-[7px] h-[14px] transition-opacity duration-500",
                    ready && "opacity-0",
                    state === "loading" &&
                      "motion-safe:animate-[water-bob_3.4s_ease-in-out_infinite]",
                  )}
                >
                  <Wave
                    className={cn(
                      "text-water-deep",
                      state === "loading" &&
                        "motion-safe:animate-[water-drift-a_3.6s_linear_infinite]",
                    )}
                  />
                  <Wave
                    lower
                    className={cn(
                      "text-water-deep opacity-40",
                      state === "loading" &&
                        "motion-safe:animate-[water-drift-b_2.4s_linear_infinite]",
                    )}
                  />
                </span>
              </span>
            )}
            <Pencil
              aria-hidden
              className={cn(
                "relative size-4",
                ready || state === "loading" ? "text-water-ink" : "text-muted-foreground",
              )}
              strokeWidth={1.8}
            />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * One period of a wave across the button, twice its width so the drift loops
 * seamlessly. Two long crests read at this size; a fine ripple does not.
 *
 * The geometry is inline because the button styles every descendant svg that
 * has no `size-` class to `size-4`, and that selector beats any utility class
 * this could carry.
 */
function Wave({ lower, className }: { lower?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 68 14"
      preserveAspectRatio="none"
      aria-hidden
      style={{ position: "absolute", left: 0, top: 0, width: "200%", height: "100%" }}
      className={className}
    >
      {/* Half a wavelength per 17 units, so translating by 34 (half the box)
          lands exactly one period on — the loop has no seam. */}
      <path
        d={
          lower
            ? "M0 9 Q 17 3.5 34 9 T 68 9 L68 14 L0 14 Z"
            : "M0 7 Q 17 1 34 7 T 68 7 L68 14 L0 14 Z"
        }
        fill="currentColor"
      />
    </svg>
  )
}

function tooltipFor(state: SchemaEditState, tableCount: number, noShapeReason?: string): string {
  switch (state) {
    case "uploading":
      return "Still uploading"
    case "loading":
      return "Loading schema"
    case "stalled":
      return "Taking longer than expected"
    case "none":
      return noShapeReason ?? "No table was found in this file"
    case "ready":
      return tableCount > 1 ? `Open ${formatCount(tableCount)} tables` : "Open schema"
  }
}
