"use client"

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react"
import { cn } from "@/lib/utils"

type SplitPaneProps = {
  list: ReactNode
  /** null closes the panel. A modal would cover the list, which is the thing the screen is for. */
  panel: ReactNode | null
  panelLabel: string
  panelWidth?: number
  /**
   * Close the panel on a press anywhere outside it.
   *
   * For a panel opened from a row to look at one thing, where the way out
   * should be everywhere. Not for a screen whose panel *is* the screen: there
   * it opens itself, it holds edits that have not been saved, and every press
   * on the list beside it would throw them away.
   */
  closeOnPressOutside?: boolean
  onClose: () => void
  className?: string
}

export function SplitPane({
  list,
  panel,
  panelLabel,
  panelWidth = 440,
  closeOnPressOutside,
  onClose,
  className,
}: SplitPaneProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const asideRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!panel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [panel, onClose])

  useEffect(() => {
    if (!panel || !closeOnPressOutside) return
    // The list beside the panel, and nothing else. Anywhere further out is
    // either chrome that owns its own presses or a select, menu or dialog the
    // panel opened — Radix renders those at the end of the body, so "outside
    // the panel" on its own would read a press on one of their options as a
    // press outside and shut the panel under the control being used.
    //
    // Pointerdown rather than click, so pressing another row's open button
    // shuts the panel before that button reopens it on the row it belongs to.
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Element)) return
      if (!rootRef.current?.contains(target)) return
      if (asideRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [panel, closeOnPressOutside, onClose])

  return (
    <div ref={rootRef} className={cn("flex min-h-0 flex-1 overflow-hidden", className)}>
      <div className="min-w-0 flex-1 overflow-auto">{list}</div>
      {panel && (
        <aside
          ref={asideRef}
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
