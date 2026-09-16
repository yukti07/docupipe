"use client"

import { FolderUp, Upload } from "lucide-react"
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
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const disabled = Boolean(disabledReason)

  function onDragOver(event: DragEvent<HTMLElement>) {
    if (disabled) return
    event.preventDefault()
    setEmptyDrop(false)
    setDrag(dragCarriesFiles(event) ? "dragging" : "dragging-invalid")
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    if (disabled) return
    event.preventDefault()
    setDrag("idle")
    // A dropped folder has to be walked, and walking it is asynchronous — so
    // the DataTransfer is read inside `filesFromDrop` before it is emptied.
    void filesFromDrop(event.dataTransfer).then((files) => {
      setEmptyDrop(files.length === 0)
      if (files.length > 0) onFiles(files)
    })
  }

  return (
    <div
      data-state={disabled ? "disabled" : drag}
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
          "border-primary-tint-border bg-[linear-gradient(120deg,var(--primary-tint-strong)_0%,var(--primary-tint)_45%,var(--card)_100%)]",
        drag === "dragging" && "border-dashed border-primary bg-primary-tint-strong",
        drag === "dragging-invalid" && "border-dashed border-error bg-error-bg",
        disabled && "border-border-subtle bg-muted",
        className,
      )}
    >
      {/* The mark sits in its own tile so the arrow reads as an object to aim at. */}
      <span
        className={cn(
          "grid size-14 place-items-center rounded-2xl border transition-colors duration-120",
          drag === "dragging-invalid"
            ? "border-error-border bg-card"
            : disabled
              ? "border-border-subtle bg-card/70"
              : "border-primary-tint-border bg-card shadow-[0_1px_2px_rgba(16,40,34,0.05)]",
        )}
      >
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
      </span>

      {drag === "dragging-invalid" ? (
        <p className="text-[14px] font-medium text-error-strong">
          That isn&apos;t a file we can take.
        </p>
      ) : (
        <p className="text-[14px] font-medium">
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
          disabled={disabled}
          // The reason is on screen below; it is repeated here so it reaches a
          // screen reader landing on the control itself.
          aria-label={disabled ? `Choose files — ${disabledReason}` : undefined}
          onClick={() => fileInput.current?.click()}
          className="h-9 gap-1.5 rounded-[10px] text-[13px] shadow-xs hover:bg-primary-hover"
        >
          <Upload aria-hidden className="size-3.5" />
          Choose files
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={disabled ? `Choose a folder — ${disabledReason}` : undefined}
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
        disabled={disabled}
        accept={ACCEPT_ATTRIBUTE}
        aria-label="Choose files"
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ""
          if (files.length > 0) onFiles(files)
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        disabled={disabled}
        // @ts-expect-error — webkitdirectory is not in the React DOM types, and is
        // the only way to offer the folder path the design asks for.
        webkitdirectory=""
        directory=""
        aria-label="Choose a folder"
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ""
          if (files.length > 0) onFiles(files)
        }}
      />
    </div>
  )
}
