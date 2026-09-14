import type { BoxFraction } from "@/lib/api/types"
import { cn } from "@/lib/utils"

/**
 * The signature interaction: the moment the cell and the document are visibly
 * the same thing. It draws over 400ms, and appears already drawn under
 * prefers-reduced-motion.
 *
 * Never a solid overlay — the user has to read what is underneath it. The outer
 * light ring is what keeps it visible on a dark scan.
 */
export function HighlightBox({
  box,
  label,
  className,
}: {
  /** Fractions of the rendered page, so the worker's boxes and pdf.js agree. */
  box: BoxFraction
  label?: string
  className?: string
}) {
  return (
    <div
      role="img"
      aria-label={label ?? "The place this value came from"}
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
      }}
      className={cn(
        "pointer-events-none absolute rounded-[3px] border-2 border-primary bg-primary/12",
        "shadow-[0_0_0_1px_rgba(255,255,255,0.4)]",
        "motion-safe:animate-[evidence-draw_400ms_ease-out]",
        className,
      )}
    />
  )
}
