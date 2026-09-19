import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@/test/render"
import { DropStrip } from "./DropStrip"

const strip = () => screen.getByText("Drop your documents here").closest("[data-state]")!

describe("DropStrip", () => {
  // The whole reason it exists is that the hero card is off screen, so
  // pointing back up at the card would be no use at all.
  it("takes a drop itself", async () => {
    const onFiles = vi.fn()
    render(<DropStrip onFiles={onFiles} shown />)
    const file = new File(["x"], "invoice-1044.pdf")
    fireEvent.drop(strip(), { dataTransfer: { types: ["Files"], files: [file] } })
    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([file]))
  })

  it("reacts before the drop lands", () => {
    render(<DropStrip onFiles={vi.fn()} shown />)
    fireEvent.dragOver(strip(), { dataTransfer: { types: ["Files"] } })
    expect(screen.getByText("Drop them here")).toBeVisible()
  })

  // There are two "Choose files" buttons on the workspace, and only one of
  // them is ever the real one.
  it("is out of the way entirely while retracted", () => {
    render(<DropStrip onFiles={vi.fn()} shown={false} />)
    expect(strip()).toHaveAttribute("aria-hidden", "true")
    expect(strip()).toHaveAttribute("inert")
  })

  it("takes nothing while the workspace is still waking up", () => {
    const onFiles = vi.fn()
    render(<DropStrip onFiles={onFiles} shown disabledReason="Waking up." />)
    expect(screen.getByRole("button", { name: /Choose files/ })).toBeDisabled()
    fireEvent.drop(screen.getByText("Waking up.").closest("[data-state]")!, {
      dataTransfer: { types: ["Files"], files: [new File(["x"], "a.pdf")] },
    })
    expect(onFiles).not.toHaveBeenCalled()
  })
})
