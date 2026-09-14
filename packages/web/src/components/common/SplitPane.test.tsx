import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@/test/render"
import { SplitPane } from "./SplitPane"

const list = <div data-testid="list">files</div>
const panel = <div data-testid="panel">detail</div>

describe("SplitPane", () => {
  it("shows only the list when closed", () => {
    render(<SplitPane list={list} panel={null} onClose={vi.fn()} panelLabel="Schema" />)
    expect(screen.getByTestId("list")).toBeVisible()
    expect(screen.queryByTestId("panel")).not.toBeInTheDocument()
  })

  it("shows both at once when open — the list must stay visible", () => {
    render(<SplitPane list={list} panel={panel} onClose={vi.fn()} panelLabel="Schema" />)
    expect(screen.getByTestId("list")).toBeVisible()
    expect(screen.getByTestId("panel")).toBeVisible()
  })

  it("closes on Escape", async () => {
    const onClose = vi.fn()
    const { user } = render(
      <SplitPane list={list} panel={panel} onClose={onClose} panelLabel="Schema" />,
    )
    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("labels the panel region for screen readers", () => {
    render(<SplitPane list={list} panel={panel} onClose={vi.fn()} panelLabel="Evidence" />)
    expect(screen.getByRole("complementary", { name: "Evidence" })).toBeInTheDocument()
  })
})
