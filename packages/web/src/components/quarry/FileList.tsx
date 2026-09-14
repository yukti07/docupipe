import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function FileList({
  summary,
  children,
  className,
}: {
  /** The honest line above the rows — counts, failures included. */
  summary?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("flex flex-col", className)}>
      {summary && (
        <div className="flex items-center justify-between gap-3 px-1 pb-2 text-[12.5px] tabular-nums text-subtle-foreground">
          {summary}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-border-subtle">{children}</div>
    </section>
  )
}
