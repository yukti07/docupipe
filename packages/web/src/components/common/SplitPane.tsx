"use client"

import { useEffect, type ReactNode } from "react"
import { cn } from "@/lib/utils"

type SplitPaneProps = {
  list: ReactNode
  /** null closes the panel. A modal would cover the list, which is the thing the screen is for. */
  panel: ReactNode | null
  panelLabel: string
  panelWidth?: number
  onClose: () => void
  className?: string
}

export function SplitPane({
  list,
  panel,
  panelLabel,
  panelWidth = 440,
  onClose,
  className,
}: SplitPaneProps) {
  useEffect(() => {
    if (!panel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [panel, onClose])

  return (
    <div className={cn("flex min-h-0 flex-1 overflow-hidden", className)}>
      <div className="min-w-0 flex-1 overflow-auto">{list}</div>
      {panel && (
        <aside
          role="complementary"
          aria-label={panelLabel}
          style={{ width: panelWidth }}
          className={cn(
            "flex min-h-0 shrink-0 flex-col overflow-auto border-l border-border-subtle bg-card",
            "motion-safe:animate-in motion-safe:slide-in-from-right-4 motion-safe:duration-200",
            // Below 1024px the two stop being legible side by side.
            "max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:w-full max-lg:max-w-[440px] max-lg:shadow-2xl",
          )}
        >
          {panel}
        </aside>
      )}
    </div>
  )
}
