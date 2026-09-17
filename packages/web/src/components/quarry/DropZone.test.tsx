import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@/test/render"
import { DropZone } from "./DropZone"

const zone = () => screen.getByText("Drop your documents here").closest("[data-state]")!

describe("DropZone", () => {
  it("states the accepted formats and the size cap inside itself", () => {
    render(<DropZone onFiles={vi.fn()} />)
    expect(screen.getByText(/PDF, Word, Excel, CSV, JSON, text, images and audio/)).toBeVisible()
    expect(screen.getByText(/Up to 50 MB a file/)).toBeVisible()
  })

  it("starts idle", () => {
    render(<DropZone onFiles={vi.fn()} />)
    expect(zone()).toHaveAttribute("data-state", "idle")
  })

  it("reacts before the drop lands, so you know it will work", () => {
    render(<DropZone onFiles={vi.fn()} />)
    fireEvent.dragOver(zone(), { dataTransfer: { types: ["Files"] } })
    expect(screen.getByText("Drop them here")).toBeVisible()
  })

  it("says so when what is being dragged is not a file at all", () => {
    render(<DropZone onFiles={vi.fn()} />)
    fireEvent.dragOver(zone(), { dataTransfer: { types: ["text/uri-list"] } })
    expect(screen.getByText(/isn't a file we can take/i)).toBeVisible()
  })

  // A dropped folder has to be walked before anything can be handed over, and
  // walking it is asynchronous — so every drop settles a tick later now.
  it("hands the dropped files over", async () => {
    const onFiles = vi.fn()
    render(<DropZone onFiles={onFiles} />)
    const file = new File(["x"], "invoice-1044.pdf")
    fireEvent.drop(zone(), { dataTransfer: { types: ["Files"], files: [file] } })
    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([file]))
  })

  it("says so when what was dropped held no files at all", async () => {
    const onFiles = vi.fn()
    render(<DropZone onFiles={onFiles} />)
    fireEvent.drop(zone(), { dataTransfer: { types: ["Files"], files: [] } })
    // By text, not by role: the zone says "Taking your files…" in the same
    // live region first, because it does take them before it finds none.
    expect(await screen.findByText("There were no files in what you dropped.")).toBeVisible()
    expect(onFiles).not.toHaveBeenCalled()
  })

  /* Handing files over starts a navigation, and a navigation takes a moment.
     For that moment every control here has to be shut, or a second selection
     starts a second batch behind the first. */

  it("shuts both buttons the moment a selection is taken", async () => {
    render(<DropZone onFiles={vi.fn()} />)
    fireEvent.change(screen.getByLabelText("Choose files"), {
      target: { files: [new File(["x"], "a.pdf")] },
    })
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Choose files/ })).toBeDisabled(),
    )
    expect(screen.getByRole("button", { name: /Choose a folder/ })).toBeDisabled()
    expect(screen.getByLabelText("Choose files")).toBeDisabled()
    expect(screen.getByLabelText("Choose a folder")).toBeDisabled()
  })

  it("says what it is doing for the second the navigation takes", async () => {
    render(<DropZone onFiles={vi.fn()} />)
    fireEvent.change(screen.getByLabelText("Choose a folder"), {
      target: { files: [new File(["x"], "q3/a.pdf")] },
    })
    expect(await screen.findByRole("status")).toHaveTextContent("Taking your files…")
  })

  it("takes only the first selection, however fast the second one comes", async () => {
    const onFiles = vi.fn()
    render(<DropZone onFiles={onFiles} />)
    const target = screen.getByText("Drop your documents here").closest("[data-state]")!

    fireEvent.drop(target, {
      dataTransfer: { types: ["Files"], files: [new File(["x"], "first.pdf")] },
    })
    await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1))

    fireEvent.drop(target, {
      dataTransfer: { types: ["Files"], files: [new File(["x"], "second.pdf")] },
    })
    fireEvent.change(screen.getByLabelText("Choose files"), {
      target: { files: [new File(["x"], "third.pdf")] },
    })

    await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1))
    expect(onFiles).toHaveBeenCalledWith([expect.objectContaining({ name: "first.pdf" })])
  })

  it("opens again when the selection turned out to hold nothing", async () => {
    render(<DropZone onFiles={vi.fn()} />)
    const target = screen.getByText("Drop your documents here").closest("[data-state]")!
    fireEvent.drop(target, { dataTransfer: { types: ["Files"], files: [] } })
    await screen.findByText("There were no files in what you dropped.")
    expect(screen.getByRole("button", { name: /Choose files/ })).toBeEnabled()
  })

  it("offers a real file input and a real folder input, so the keyboard can do everything", () => {
    render(<DropZone onFiles={vi.fn()} />)
    const files = screen.getByLabelText("Choose files")
    const folder = screen.getByLabelText("Choose a folder")
    expect(files).toHaveAttribute("type", "file")
    expect(files).toHaveAttribute("multiple")
    expect(folder).toHaveAttribute("webkitdirectory")
  })

  it("takes nothing while disabled, and says what would change that", () => {
    const onFiles = vi.fn()
    render(<DropZone onFiles={onFiles} disabledReason="This batch has already been converted." />)
    const target = screen.getByText("Drop your documents here").closest("[data-state]")!
    expect(target).toHaveAttribute("data-state", "disabled")
    expect(screen.getByText("This batch has already been converted.")).toBeVisible()
    expect(screen.getByRole("button", { name: /Choose files/ })).toBeDisabled()
    fireEvent.drop(target, { dataTransfer: { types: ["Files"], files: [new File(["x"], "a.pdf")] } })
    expect(onFiles).not.toHaveBeenCalled()
  })
})
