import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@/test/render"
import { MarkedCellNav } from "./MarkedCellNav"
import { RawTextView } from "./RawTextView"

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

describe("RawTextView", () => {
  it("names the wait, then shows the text as it came off each page", async () => {
    render(<RawTextView requestId="req_1" schemaId="sch_32" />)
    expect(screen.getByText("Reading the text off the pages")).toBeVisible()

    await waitFor(() => expect(screen.getByText("Page 1")).toBeVisible())
    expect(screen.getByText(/before any of it became fields/)).toBeVisible()
    // The header appears on every page of the fixture, which is the point.
    expect(screen.getAllByText(/FERRO CASTINGS LTD/)).toHaveLength(3)
    expect(screen.getByText("Page 2")).toBeVisible()
    expect(screen.getByText("Page 3")).toBeVisible()
  })
})
