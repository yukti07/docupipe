"use client"

import { useRef, useState, type DragEvent, type ReactNode } from "react"
import { filesFromDrop } from "@/lib/dropped"
import { ACCEPT_ATTRIBUTE } from "@/lib/preflight"

/** What the surface says about itself once it has taken a selection. */
export const HANDING_OVER = "Taking your files…"

export type DragState = "idle" | "dragging" | "dragging-invalid"

export type FileIntake = {
  drag: DragState
  /** One idea — "nothing here takes input" — however it came about. */
  inert: boolean
  /** A reason, not a boolean — a dead drop surface has to say why it is dead. */
  inertReason: string | null
  handing: boolean
  /**
   * True only after a *drop* that held nothing. A cancelled file picker is not
   * a thing anyone needs told back to them.
   */
  emptyDrop: boolean
  /** Spread onto the element that is the drop target. */
  zoneProps: {
    "data-state": string
    onDragOver: (event: DragEvent<HTMLElement>) => void
    onDragLeave: () => void
    onDrop: (event: DragEvent<HTMLElement>) => void
  }
  openFiles: () => void
  openFolder: () => void
  /** Real inputs, not a div pretending: the keyboard does everything the mouse can. */
  inputs: ReactNode
}

/** Anything that is not a file — a dragged link, a selection, a folder of nothing. */
function dragCarriesFiles(event: DragEvent<HTMLElement>): boolean {
  const types = Array.from(event.dataTransfer?.types ?? [])
  return types.includes("Files")
}

/**
 * Taking files from a surface — dragged onto it, or picked through it.
 *
 * Two surfaces on the workspace take files: the hero card and the sticky strip
 * that replaces it on scroll. Both behave identically down to the handing lock,
 * so the behaviour lives here and neither surface owns it.
 */
export function useFileIntake({
  onFiles,
  disabledReason,
  /** Distinguishes the two surfaces' hidden inputs from each other. */
  inputLabelSuffix,
}: {
  onFiles: (files: File[]) => void
  disabledReason?: string | null
  inputLabelSuffix?: string
}): FileIntake {
  const [drag, setDrag] = useState<DragState>("idle")
  const [emptyDrop, setEmptyDrop] = useState(false)
  /**
   * Shut from the instant a selection is taken.
   *
   * Handing files over starts a navigation, and a navigation is not instant —
   * for the second it takes, every control here is still live and a second
   * selection would start a second batch behind the first. It is only released
   * when the selection turned out to hold nothing, because in every other case
   * the caller is moving the screen on and this surface is going away with it.
   */
  const [handing, setHanding] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  const disabled = Boolean(disabledReason)
  const inert = disabled || handing
  const inertReason = disabledReason ?? (handing ? HANDING_OVER : null)

  /** The one way out of this hook, whichever control was used. */
  function hand(files: File[]) {
    setHanding(files.length > 0)
    if (files.length === 0) return
    setEmptyDrop(false)
    try {
      onFiles(files)
    } catch {
      // The caller is expected to navigate this surface away; if it throws
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
      setEmptyDrop(files.length === 0)
      hand(files)
    })
  }

  /** `disabled` stops a picker being opened; it does not stop one that is
      already open from answering after the surface has shut. */
  function taken(event: { target: HTMLInputElement }) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""
    if (!inert) hand(files)
  }

  const suffix = inputLabelSuffix ? ` (${inputLabelSuffix})` : ""

  return {
    drag,
    inert,
    inertReason,
    handing,
    emptyDrop,
    zoneProps: {
      "data-state": disabled ? "disabled" : handing ? "handing" : drag,
      onDragOver,
      onDragLeave: () => setDrag("idle"),
      onDrop,
    },
    openFiles: () => fileInput.current?.click(),
    openFolder: () => folderInput.current?.click(),
    inputs: (
      <>
        <input
          ref={fileInput}
          type="file"
          multiple
          // Disabled with the surface: the input is the keyboard path, and a
          // selection it silently swallowed would be worse than one it refuses.
          disabled={inert}
          accept={ACCEPT_ATTRIBUTE}
          aria-label={`Choose files${suffix}`}
          className="sr-only"
          onChange={taken}
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
          aria-label={`Choose a folder${suffix}`}
          className="sr-only"
          onChange={taken}
        />
      </>
    ),
  }
}
