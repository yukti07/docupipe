"use client"

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react"
import { AppHeader } from "@/components/quarry/AppHeader"
import { BatchNav, type BatchPhase, type BatchScreen } from "@/components/quarry/BatchNav"
import { cn } from "@/lib/utils"

export type BatchShellProps = {
  requestId: string
  current: BatchScreen
  done: { files: boolean; schemas: boolean }
  phase: BatchPhase
  /** A screen underneath Results — "Merge", or a filename. */
  tail?: ReactNode
  children: ReactNode
  /** A `BatchFooter`. Omitted only where a screen has nothing to offer. */
  footer?: ReactNode
  panel?: ReactNode | null
  panelLabel?: string
  panelWidth?: number
  /** Leave unset for a panel that *is* the screen and holds unsaved work. */
  closePanelOnPressOutside?: boolean
  onClosePanel?: () => void
  className?: string
}

/**
 * The chrome every screen inside a batch shares: the header and its rail, a
 * scrolling body, a footer pinned to the bottom of the window, and the side
 * panel, which occupies the body's row and stops where the footer starts.
 *
 * It exists because the five batch screens had settled on four different
 * idioms for the same three things, and because a button that moves between
 * screens is a button people stop looking for. Wherever you are in a batch,
 * what you can do next is in the same place.
 */
export function BatchShell({
  requestId,
  current,
  done,
  phase,
  tail,
  children,
  footer,
  panel,
  panelLabel = "Panel",
  panelWidth = 460,
  closePanelOnPressOutside,
  onClosePanel,
  className,
}: BatchShellProps) {
  const asideRef = useRef<HTMLElement>(null)
  const open = Boolean(panel)

  useEffect(() => {
    if (!open || !onClosePanel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClosePanel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClosePanel])

  useEffect(() => {
    if (!open || !closePanelOnPressOutside || !onClosePanel) return
    // A press outside the panel does its own job first, and only a press that
    // had no job of its own closes the panel. Pressing Convert converts;
    // pressing a pencil moves the panel to that row; pressing the page's
    // background — a heading, a card's padding, the space under the list — is
    // the only press that means "I'm done with this".
    //
    // Pointerdown rather than click, so pressing another row's open button
    // shuts the panel before that button reopens it on the row it belongs to.
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Element)) return
      if (asideRef.current?.contains(target)) return
      if (isInteractive(target)) return
      onClosePanel()
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open, closePanelOnPressOutside, onClosePanel])

  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <AppHeader>
        <BatchNav requestId={requestId} current={current} done={done} phase={phase} tail={tail} />
      </AppHeader>

      {/* The body and the panel share one row, and the footer sits below both.
          The footer holds the actions — Convert among them — and an action you
          cannot see is an action you do not have, so nothing is allowed to
          cover it. */}
      <div className="relative flex min-h-0 flex-1">
        <div
          // The panel must not overlay the content either, so the content gives
          // up the width the panel takes — but only where the two fit side by
          // side. Below `lg` the panel covers the body, which is the only way
          // either of them is legible.
          style={{ "--panel-width": `${panelWidth}px` } as CSSProperties}
          className={cn(
            "min-h-0 flex-1 overflow-auto transition-[padding] duration-200",
            open && "lg:pr-[var(--panel-width)]",
            className,
          )}
        >
          {children}
        </div>

        {panel && (
          <aside
            ref={asideRef}
            role="complementary"
            aria-label={panelLabel}
            style={{ "--panel-width": `${panelWidth}px` } as CSSProperties}
            className={cn(
              "absolute inset-y-0 right-0 z-40 flex w-full max-w-[440px] flex-col overflow-auto",
              "border-l border-border-subtle bg-card shadow-2xl",
              "motion-safe:animate-in motion-safe:slide-in-from-right-4 motion-safe:duration-200",
              "lg:w-[var(--panel-width)] lg:max-w-none",
            )}
          >
            {panel}
          </aside>
        )}
      </div>

      {footer}
    </div>
  )
}

/**
 * Whether the press landed on something that does a job of its own.
 *
 * Deliberately wide: a select's option, a checkbox, a search box and a link all
 * count, because closing the panel under any of them makes the press do two
 * things at once. `[data-panel-open]` is here for the controls whose job is to
 * put something *else* in the panel — without it, pressing another row's pencil
 * would close the panel on pointerdown and reopen it on click, two state
 * changes racing to produce what should be one.
 */
function isInteractive(target: Element): boolean {
  return Boolean(
    target.closest(
      "a[href], button, input, select, textarea, summary, label, [role=button]," +
        " [role=link], [role=option], [role=menuitem], [role=checkbox], [role=switch]," +
        " [role=tab], [role=combobox], [contenteditable=true], [data-panel-open]",
    ),
  )
}
