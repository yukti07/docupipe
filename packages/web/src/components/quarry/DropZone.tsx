"use client"

import { FolderUp, Loader2, Upload } from "lucide-react"
import { useRef, useState, type DragEvent } from "react"
import { Button } from "@/components/ui/button"
import { filesFromDrop } from "@/lib/dropped"
import { ACCEPTED_SUMMARY, ACCEPT_ATTRIBUTE, SIZE_CAP_SUMMARY } from "@/lib/preflight"
import { cn } from "@/lib/utils"

type DropZoneProps = {
  onFiles: (files: File[]) => void
  /** A reason, not a boolean — a dead drop zone has to say why it is dead. */
  disabledReason?: string | null
  className?: string
}

/** What the zone says about itself once it has taken a selection. */
const HANDING_OVER = "Taking your files…"

/** Anything that is not a file — a dragged link, a selection, a folder of nothing. */
function dragCarriesFiles(event: DragEvent<HTMLElement>): boolean {
  const types = Array.from(event.dataTransfer?.types ?? [])
  return types.includes("Files")
}

export function DropZone({ onFiles, disabledReason, className }: DropZoneProps) {
  const [drag, setDrag] = useState<"idle" | "dragging" | "dragging-invalid">("idle")
  // A folder with nothing in it is a drop that would otherwise do nothing at
  // all, and a drop zone that swallows a drop is the worst of the options.
  const [emptyDrop, setEmptyDrop] = useState(false)
  /**
   * Shut from the instant a selection is taken.
   *
   * Handing files over starts a navigation, and a navigation is not instant —
   * for the second it takes, every control here is still live and a second
   * selection would start a second batch behind the first. It is only released
   * when the selection turned out to hold nothing, because in every other case
   * the caller is moving the screen on and this zone is going away with it.
   */
  const [handing, setHanding] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  const disabled = Boolean(disabledReason)
  // One idea — "nothing here takes input" — however it came about.
  const inert = disabled || handing
  const inertReason = disabledReason ?? (handing ? HANDING_OVER : null)

  /** The one way out of this component, whichever control was used. */
  function hand(files: File[]) {
    setHanding(files.length > 0)
    if (files.length === 0) return
    setEmptyDrop(false)
    try {
      onFiles(files)
    } catch {
      // The caller is expected to navigate this component away; if it throws
      // before that happens, nothing else would ever let go of the spinner.
      setHanding(false)
    }
  }

  function onDragOver(event: DragEvent<HTMLElement>) {
    if (inert) return
    event.preventDefault()
    setEmptyDrop(false)
    setDrag(dragCarriesFiles(event) ? "dragging" : "dragging-invalid")
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    if (inert) return
    event.preventDefault()
    setDrag("idle")
    // Shut before the walk, not after it: a dropped folder is read
    // asynchronously, and that read is its own window for a second drop.
    setHanding(true)
    // The DataTransfer is read inside `filesFromDrop` before it is emptied.
    void filesFromDrop(event.dataTransfer).then((files) => {
      // Only a drop can turn out to hold nothing worth saying so about — a
      // cancelled file picker is not a thing anyone needs told back to them.
      setEmptyDrop(files.length === 0)
      hand(files)
    })
  }

  return (
    <div
      data-state={disabled ? "disabled" : handing ? "handing" : drag}
      onDragOver={onDragOver}
      onDragLeave={() => setDrag("idle")}
      onDrop={onDrop}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border px-6 py-12 text-center transition-colors duration-120",
        // Idle is a quiet card washed with the accent from both corners — the
        // one place a gradient is spent, because this area *is* the page.
        // A slanted ramp: the accent at full tint in the top-left corner,
        // washing out to the plain card by the bottom-right.
        drag === "idle" &&
          !inert &&
          "border-primary-tint-border bg-[linear-gradient(120deg,var(--primary-tint-strong)_0%,var(--primary-tint)_45%,var(--card)_100%)]",
        drag === "dragging" && !inert && "border-dashed border-primary bg-primary-tint-strong",
        drag === "dragging-invalid" && !inert && "border-dashed border-error bg-error-bg",
        handing && "border-primary-tint-border bg-card",
        disabled && "border-border-subtle bg-muted",
        className,
      )}
    >
      {/* The mark sits in its own tile so the arrow reads as an object to aim at. */}
      <span
        className={cn(
          "grid size-14 place-items-center rounded-2xl border transition-colors duration-120",
          drag === "dragging-invalid" && !inert
            ? "border-error-border bg-card"
            : disabled
              ? "border-border-subtle bg-card/70"
              : "border-primary-tint-border bg-card shadow-[0_1px_2px_rgba(16,40,34,0.05)]",
        )}
      >
        {handing ? (
          <Loader2 aria-hidden className="size-6 animate-spin text-primary" strokeWidth={1.7} />
        ) : (
          <Upload
            aria-hidden
            className={cn(
              "size-6",
              drag === "dragging-invalid"
                ? "text-error"
                : disabled
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
        <p key="handing" role="status" className="text-[14px] font-medium">
          {HANDING_OVER}
        </p>
      ) : drag === "dragging-invalid" ? (
        <p key="invalid" className="text-[14px] font-medium text-error-strong">
          That isn&apos;t a file we can take.
        </p>
      ) : (
        <p key="prompt" className="text-[14px] font-medium">
          {drag === "dragging" ? "Drop them here" : "Drop your documents here"}
        </p>
      )}

      {/* The limits are written inside the zone, before anyone has tried anything. */}
      <p className="text-[12.5px] leading-[1.6] text-subtle-foreground">
        {ACCEPTED_SUMMARY} <span className="text-muted-foreground">·</span>{" "}
        {/* The cap is one phrase — it never breaks across "50 MB / a file". */}
        <span className="whitespace-nowrap">{SIZE_CAP_SUMMARY}</span>
      </p>

      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        {/* One primary per screen, and on the workspace this is it. */}
        <Button
          type="button"
          disabled={inert}
          // The reason is on screen below; it is repeated here so it reaches a
          // screen reader landing on the control itself.
          aria-label={inertReason ? `Choose files — ${inertReason}` : undefined}
          onClick={() => fileInput.current?.click()}
          className="h-9 gap-1.5 rounded-[10px] text-[13px] shadow-xs hover:bg-primary-hover"
        >
          <Upload aria-hidden className="size-3.5" />
          Choose files
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={inert}
          aria-label={inertReason ? `Choose a folder — ${inertReason}` : undefined}
          onClick={() => folderInput.current?.click()}
          className="h-9 gap-1.5 rounded-[10px] bg-card text-[13px]"
        >
          <FolderUp aria-hidden className="size-3.5" />
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

      {/* Real inputs, not a div pretending: the keyboard does everything the mouse can. */}
      <input
        ref={fileInput}
        type="file"
        multiple
        // Disabled with the zone: the input is the keyboard path, and a drop it
        // silently swallowed would be worse than one it refuses.
        disabled={inert}
        accept={ACCEPT_ATTRIBUTE}
        aria-label="Choose files"
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ""
          // `disabled` stops a picker being opened; it does not stop one that
          // is already open from answering after the zone has shut.
          if (!inert) hand(files)
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        disabled={inert}
        // @ts-expect-error — webkitdirectory is not in the React DOM types, and is
        // the only way to offer the folder path the design asks for.
        webkitdirectory=""
        directory=""
        aria-label="Choose a folder"
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ""
          // `disabled` stops a picker being opened; it does not stop one that
          // is already open from answering after the zone has shut.
          if (!inert) hand(files)
        }}
      />
    </div>
  )
}
