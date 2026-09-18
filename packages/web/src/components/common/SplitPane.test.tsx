import { createPortal } from "react-dom"
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

  it("closes a peeked-into panel on a press in the list beside it", async () => {
    const onClose = vi.fn()
    const { user } = render(
      <SplitPane
        list={list}
        panel={panel}
        closeOnPressOutside
        onClose={onClose}
        panelLabel="Schema"
      />,
    )
    await user.click(screen.getByTestId("list"))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("stays open on a press inside itself", async () => {
    const onClose = vi.fn()
    const { user } = render(
      <SplitPane
        list={list}
        panel={panel}
        closeOnPressOutside
        onClose={onClose}
        panelLabel="Schema"
      />,
    )
    await user.click(screen.getByTestId("panel"))
    expect(onClose).not.toHaveBeenCalled()
  })

  it("survives a press on a menu it opened, which renders outside it", async () => {
    const onClose = vi.fn()
    const { user } = render(
      <SplitPane
        list={list}
        panel={
          <>
            {panel}
            {createPortal(<button type="button">currency</button>, document.body)}
          </>
        }
        closeOnPressOutside
        onClose={onClose}
        panelLabel="Schema"
      />,
    )
    // Picking a type must not shut the editor the type belongs to.
    await user.click(screen.getByRole("button", { name: "currency" }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it("holds a panel that is the screen open through a press beside it", async () => {
    const onClose = vi.fn()
    const { user } = render(
      <SplitPane list={list} panel={panel} onClose={onClose} panelLabel="Schema" />,
    )
    await user.click(screen.getByTestId("list"))
    expect(onClose).not.toHaveBeenCalled()
  })
})
