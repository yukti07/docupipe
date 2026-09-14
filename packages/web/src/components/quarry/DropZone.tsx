"use client"

import { FolderUp, Upload } from "lucide-react"
import { useRef, useState, type DragEvent } from "react"
import { Button } from "@/components/ui/button"
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
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const disabled = Boolean(disabledReason)

  function onDragOver(event: DragEvent<HTMLElement>) {
    if (disabled) return
    event.preventDefault()
    setDrag(dragCarriesFiles(event) ? "dragging" : "dragging-invalid")
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    if (disabled) return
    event.preventDefault()
    setDrag("idle")
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length > 0) onFiles(files)
  }

  return (
    <div
      data-state={disabled ? "disabled" : drag}
      onDragOver={onDragOver}
      onDragLeave={() => setDrag("idle")}
      onDrop={onDrop}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center transition-colors duration-120",
        drag === "idle" && "border-border bg-card",
        drag === "dragging" && "border-primary bg-primary-tint",
        drag === "dragging-invalid" && "border-error bg-error-bg",
        disabled && "border-border-subtle bg-muted",
        className,
      )}
    >
      <Upload
        aria-hidden
        className={cn("size-6", drag === "dragging-invalid" ? "text-error" : "text-muted-foreground")}
        strokeWidth={1.6}
      />

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
      <p className="text-[12.5px] text-muted-foreground">
        {ACCEPTED_SUMMARY} · {SIZE_CAP_SUMMARY}
      </p>

      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          // The reason is on screen below; it is repeated here so it reaches a
          // screen reader landing on the control itself.
          aria-label={disabled ? `Choose files — ${disabledReason}` : undefined}
          onClick={() => fileInput.current?.click()}
          className="h-9 gap-1.5 rounded-[10px] bg-card text-[13px]"
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
