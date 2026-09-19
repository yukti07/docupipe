"use client"

import { FolderUp, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ACCEPTED_SUMMARY } from "@/lib/preflight"
import { useFileIntake } from "@/lib/useFileIntake"
import { cn } from "@/lib/utils"

/**
 * The drop target once the hero card has scrolled away.
 *
 * It takes drops itself rather than pointing back up at the card: the whole
 * reason it exists is that the card is off screen.
 */
export function DropStrip({
  onFiles,
  disabledReason,
  shown,
}: {
  onFiles: (files: File[]) => void
  disabledReason?: string | null
  /** Driven by a sentinel under the hero card, not by a scroll offset. */
  shown: boolean
}) {
  const intake = useFileIntake({ onFiles, disabledReason, inputLabelSuffix: "toolbar" })

  return (
    // Zero-height so the strip overlays the page instead of shifting it, and
    // sticky so it stays put while the history scrolls under it.
    <div className="sticky top-0 z-30 h-0">
      <div
        {...intake.zoneProps}
        // Retracted, it is out of the tab order and out of the accessibility
        // tree — there are two "Choose files" buttons on this page, and only
        // one of them is ever the real one.
        aria-hidden={!shown}
        inert={!shown || undefined}
        className={cn(
          "absolute inset-x-0 top-0 flex h-[58px] items-center border-b backdrop-blur-md transition-[transform,opacity] duration-[260ms] ease-out",
          shown ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-full opacity-0",
          // At 58px this is a small target, so a live drag fills it rather
          // than outlining it the way the big card can afford to.
          intake.drag === "dragging" && !intake.inert
            ? "border-primary bg-primary-tint-strong"
            : intake.drag === "dragging-invalid" && !intake.inert
              ? "border-error-border bg-error-bg"
              : "border-border-subtle bg-card/95",
        )}
      >
        <div className="mx-auto flex h-full w-full max-w-[1100px] items-center gap-3.5 px-6">
          <span className="grid size-[30px] flex-none place-items-center rounded-[9px] bg-primary-tint text-primary">
            {intake.handing ? (
              <Loader2 aria-hidden className="size-4 animate-spin" strokeWidth={1.9} />
            ) : (
              <Upload aria-hidden className="size-4" strokeWidth={1.9} />
            )}
          </span>
          <span className="whitespace-nowrap text-[13.5px] font-medium">
            {intake.inertReason ??
              (intake.drag === "dragging" ? "Drop them here" : "Drop your documents here")}
          </span>
          {/* The format line is the first thing to go when the window narrows —
              it is a reminder here, not the place anyone first reads it. */}
          <span className="hidden truncate text-[12.5px] text-subtle-foreground lg:block">
            {ACCEPTED_SUMMARY}
          </span>

          <div className="ml-auto flex flex-none gap-2">
            <Button
              type="button"
              disabled={intake.inert}
              onClick={intake.openFiles}
              className="h-[34px] gap-1.5 rounded-[9px] text-[13px] shadow-xs hover:bg-primary-hover"
            >
              Choose files
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={intake.inert}
              onClick={intake.openFolder}
              className="hidden h-[34px] gap-1.5 rounded-[9px] bg-card text-[13px] sm:inline-flex"
            >
              <FolderUp aria-hidden className="size-3.5" />
              Choose a folder
            </Button>
          </div>
        </div>
        {intake.inputs}
      </div>
    </div>
  )
}
