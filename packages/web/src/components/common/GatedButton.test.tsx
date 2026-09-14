import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@/test/render"
import { GatedButton } from "./GatedButton"

describe("GatedButton", () => {
  it("puts the reason in the accessible name, not only on screen", () => {
    render(<GatedButton reason="7 files are still reading their shape">Convert</GatedButton>)
    expect(
      screen.getByRole("button", {
        name: /Convert.*7 files are still reading their shape/i,
      }),
    ).toBeDisabled()
  })

  it("shows the reason as text beside the button", () => {
    render(<GatedButton reason="No schemas ready yet">Review schemas</GatedButton>)
    expect(screen.getByText("No schemas ready yet")).toBeVisible()
  })

  it("is enabled and clickable when no reason is given", async () => {
    const onClick = vi.fn()
    const { user } = render(<GatedButton onClick={onClick}>Convert</GatedButton>)
    await user.click(screen.getByRole("button", { name: "Convert" }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it("does not fire when gated", async () => {
    const onClick = vi.fn()
    const { user } = render(
      <GatedButton reason="Nothing selected" onClick={onClick}>Merge</GatedButton>,
    )
    await user.click(screen.getByRole("button", { name: /Merge/ }))
    expect(onClick).not.toHaveBeenCalled()
  })
})
