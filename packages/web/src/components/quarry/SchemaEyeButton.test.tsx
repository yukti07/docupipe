import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@/test/render"
import { SchemaEyeButton } from "./SchemaEyeButton"

describe("SchemaEyeButton", () => {
  it.each([
    ["uploading", "Still uploading"],
    ["loading", "Loading schema"],
    ["stalled", "Taking longer than expected"],
    ["none", "No table was found in this file"],
  ] as const)("is disabled while %s, and says why", (state, label) => {
    render(<SchemaEyeButton state={state} onOpen={vi.fn()} />)
    expect(screen.getByRole("button", { name: label })).toBeDisabled()
  })

  it("opens once the schema is in, and counts the tables behind it", async () => {
    const onOpen = vi.fn()
    const { user } = render(<SchemaEyeButton state="ready" tableCount={3} onOpen={onOpen} />)
    await user.click(screen.getByRole("button", { name: "Open 3 tables" }))
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it("holds water at half while it waits, and fills when the schema lands", () => {
    const { container, rerender } = render(<SchemaEyeButton state="loading" onOpen={vi.fn()} />)
    const water = () => container.querySelector("[data-water]")!
    expect(water().className).toContain("h-1/2")

    // The waves are sized inline, because the button's own rule would otherwise
    // force every svg inside it to 16px square.
    const wave = container.querySelector("svg[viewBox='0 0 68 14']") as SVGElement
    expect(wave.style.width).toBe("200%")

    rerender(<SchemaEyeButton state="ready" tableCount={1} onOpen={vi.fn()} />)
    expect(water().className).toContain("h-full")
    expect(water().className).not.toContain("h-1/2")
  })

  it("shows no water at all before the file has landed", () => {
    const { container } = render(<SchemaEyeButton state="uploading" onOpen={vi.fn()} />)
    expect(container.querySelector("svg[viewBox='0 0 68 14']")).toBeNull()
  })
})
