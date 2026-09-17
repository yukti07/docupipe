"use client"

import { useEffect, type CSSProperties, type ReactNode } from "react"
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
          // Carried as a custom property rather than an inline width: an inline
          // width beats every class, so the narrow-screen sizing below could
          // never take effect and the panel hung off the left of a phone.
          style={{ "--panel-width": `${panelWidth}px` } as CSSProperties}
          className={cn(
            "flex min-h-0 shrink-0 flex-col overflow-auto border-l border-border-subtle bg-card",
            "motion-safe:animate-in motion-safe:slide-in-from-right-4 motion-safe:duration-200",
            // Below 1024px the two stop being legible side by side.
            "fixed inset-y-0 right-0 z-40 w-full max-w-[440px] shadow-2xl",
            "lg:static lg:z-auto lg:w-[var(--panel-width)] lg:max-w-none lg:shadow-none",
          )}
        >
          {panel}
        </aside>
      )}
    </div>
  )
}
