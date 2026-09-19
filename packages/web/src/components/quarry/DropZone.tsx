"use client"

import { FolderUp, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ACCEPTED_SUMMARY, SIZE_CAP_SUMMARY } from "@/lib/preflight"
import { HANDING_OVER, useFileIntake } from "@/lib/useFileIntake"
import { cn } from "@/lib/utils"

type DropZoneProps = {
  onFiles: (files: File[]) => void
  /** A reason, not a boolean — a dead drop zone has to say why it is dead. */
  disabledReason?: string | null
  className?: string
}

/**
 * The workspace's hero: a card big enough to be the page rather than a box
 * sitting on it, because dropping files is the only thing to do here.
 */
export function DropZone({ onFiles, disabledReason, className }: DropZoneProps) {
  const intake = useFileIntake({ onFiles, disabledReason })
  const { drag, inert, inertReason, handing, emptyDrop } = intake

  return (
    <div
      {...intake.zoneProps}
      data-testid="drop-card"
      className={cn(
        "relative flex min-h-[460px] flex-col items-center justify-center gap-5 rounded-[20px] border-[1.5px] px-6 py-12 text-center transition-colors duration-120",
        // Idle is a quiet card washed with the accent from both corners — the
        // one place a gradient is spent, because this area *is* the page.
        // A slanted ramp: the accent at full tint in the top-left corner,
        // washing out to the plain card by the bottom-right.
        drag === "idle" &&
          !inert &&
          "border-dashed border-primary-dash bg-[linear-gradient(135deg,var(--primary-tint-strong)_0%,var(--card)_52%,var(--primary-tint)_100%)]",
        drag === "dragging" && !inert && "border-dashed border-primary bg-primary-tint-strong",
        drag === "dragging-invalid" && !inert && "border-dashed border-error bg-error-bg",
        handing && "border-primary-tint-border bg-card",
        disabledReason && "border-border-subtle bg-muted",
        className,
      )}
    >
      {/* The mark sits in its own tile so the arrow reads as an object to aim at. */}
      <span
        className={cn(
          "grid size-[74px] place-items-center rounded-[20px] transition-colors duration-120",
          drag === "dragging-invalid" && !inert
            ? "border border-error-border bg-card"
            : disabledReason
              ? "border border-border-subtle bg-card/70"
              : "bg-card shadow-[0_12px_30px_-18px_rgba(20,25,40,0.45)]",
        )}
      >
        {handing ? (
          <Loader2 aria-hidden className="size-8 animate-spin text-primary" strokeWidth={1.7} />
        ) : (
          <Upload
            aria-hidden
            className={cn(
              "size-8",
              drag === "dragging-invalid"
                ? "text-error"
                : disabledReason
                  ? "text-muted-foreground"
                  : "text-primary",
            )}
            strokeWidth={1.7}
          />
        )}
      </span>

      {/* Keyed apart on purpose. These are one <p> in one slot, so without a
          key React reuses the node between them — and the `role` the handing
          line carries outlives it, leaving the idle headline announcing
          itself to a screen reader as though it had just changed. */}
      {handing ? (
        // Announced, because the second this covers is a second in which
        // nothing else on screen has changed yet.
        <p
          key="handing"
          role="status"
          className="text-[clamp(22px,3.4vw,32px)] font-semibold leading-[1.2] tracking-[-0.03em]"
        >
          {HANDING_OVER}
        </p>
      ) : drag === "dragging-invalid" ? (
        <p
          key="invalid"
          className="text-[clamp(22px,3.4vw,32px)] font-semibold leading-[1.2] tracking-[-0.03em] text-error-strong"
        >
          That isn&apos;t a file we can take.
        </p>
      ) : (
        <p
          key="prompt"
          className="text-[clamp(22px,3.4vw,32px)] font-semibold leading-[1.2] tracking-[-0.03em]"
        >
          {drag === "dragging" ? "Drop them here" : "Drop your documents here"}
        </p>
      )}

      {/* The limits are written inside the zone, before anyone has tried anything. */}
      <p className="text-[15px] leading-[1.5] text-subtle-foreground">
        {ACCEPTED_SUMMARY} <span className="text-muted-foreground">·</span>{" "}
        {/* The cap is one phrase — it never breaks across "50 MB / a file". */}
        <span className="whitespace-nowrap">{SIZE_CAP_SUMMARY}</span>
      </p>

      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-3">
        {/* One primary per screen, and on the workspace this is it. */}
        <Button
          type="button"
          disabled={inert}
          // The reason is on screen below; it is repeated here so it reaches a
          // screen reader landing on the control itself.
          aria-label={inertReason ? `Choose files — ${inertReason}` : undefined}
          onClick={intake.openFiles}
          className="h-[46px] gap-2.5 rounded-xl px-5 text-[15px] shadow-xs hover:bg-primary-hover"
        >
          <Upload aria-hidden className="size-4" />
          Choose files
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={inert}
          aria-label={inertReason ? `Choose a folder — ${inertReason}` : undefined}
          onClick={intake.openFolder}
          className="h-[46px] gap-2.5 rounded-xl bg-card px-5 text-[15px]"
        >
          <FolderUp aria-hidden className="size-4" />
          Choose a folder
        </Button>
      </div>

      {disabledReason && (
        <p className="text-[12.5px] text-muted-foreground">{disabledReason}</p>
      )}

      {emptyDrop && !disabledReason && (
        <p role="status" className="text-[12.5px] text-muted-foreground">
          There were no files in what you dropped.
        </p>
      )}

      {intake.inputs}
    </div>
  )
}
