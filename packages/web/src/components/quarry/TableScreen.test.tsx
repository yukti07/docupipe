import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@/test/render"
import { MarkedCellNav } from "./MarkedCellNav"

describe("MarkedCellNav", () => {
  const ids = ["val_a", "val_b", "val_c"]

  it("says how many there are before one is selected", () => {
    render(<MarkedCellNav valueIds={ids} currentValueId={null} onSelect={vi.fn()} />)
    expect(screen.getByText("3 to check")).toBeVisible()
  })

  it("reads 2 of 3 once you are inside the set", () => {
    render(<MarkedCellNav valueIds={ids} currentValueId="val_b" onSelect={vi.fn()} />)
    expect(screen.getByText("2 of 3")).toBeVisible()
  })

  it("moves the selection forwards, which is what moves the evidence panel", async () => {
    const onSelect = vi.fn()
    const { user } = render(
      <MarkedCellNav valueIds={ids} currentValueId="val_b" onSelect={onSelect} />,
    )
    await user.click(screen.getByRole("button", { name: "Next cell to check" }))
    expect(onSelect).toHaveBeenCalledWith("val_c")
  })

  it("wraps around rather than dead-ending at either edge", async () => {
    const onSelect = vi.fn()
    const { user } = render(
      <MarkedCellNav valueIds={ids} currentValueId="val_a" onSelect={onSelect} />,
    )
    await user.click(screen.getByRole("button", { name: "Previous cell to check" }))
    expect(onSelect).toHaveBeenCalledWith("val_c")
  })

  it("renders nothing at all when there is nothing to check", () => {
    const { container } = render(
      <MarkedCellNav valueIds={[]} currentValueId={null} onSelect={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
