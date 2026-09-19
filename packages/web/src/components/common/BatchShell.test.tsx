import { createPortal } from "react-dom"
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@/test/render"
import { BatchFooter } from "./BatchFooter"
import { BatchShell } from "./BatchShell"

const body = <div data-testid="body">files</div>
const panel = <div data-testid="panel">detail</div>

const shell = (props: Partial<React.ComponentProps<typeof BatchShell>> = {}) => (
  <BatchShell
    requestId="req_01KABC"
    current="files"
    done={{ files: true, schemas: false }}
    phase="prepare"
    panelLabel="Schema"
    onClosePanel={vi.fn()}
    {...props}
  >
    {body}
  </BatchShell>
)

describe("BatchShell", () => {
  it("shows the body without a panel", () => {
    render(shell())
    expect(screen.getByTestId("body")).toBeVisible()
    expect(screen.queryByTestId("panel")).not.toBeInTheDocument()
  })

  it("shows both at once — the body must stay visible beside the panel", () => {
    render(shell({ panel }))
    expect(screen.getByTestId("body")).toBeVisible()
    expect(screen.getByTestId("panel")).toBeVisible()
  })

  it("labels the panel region for screen readers", () => {
    render(shell({ panel, panelLabel: "Evidence" }))
    expect(screen.getByRole("complementary", { name: "Evidence" })).toBeInTheDocument()
  })

  it("closes on Escape", async () => {
    const onClosePanel = vi.fn()
    const { user } = render(shell({ panel, onClosePanel }))
    await user.keyboard("{Escape}")
    expect(onClosePanel).toHaveBeenCalledOnce()
  })

  it("keeps the footer's actions in the tree beside an open panel", () => {
    render(
      shell({
        panel,
        footer: <BatchFooter actions={<button type="button">Convert</button>} />,
      }),
    )
    expect(screen.getByRole("button", { name: "Convert" })).toBeVisible()
  })

  describe("a press outside the panel", () => {
    const openShell = (onClosePanel: () => void) =>
      render(
        shell({
          panel,
          closePanelOnPressOutside: true,
          onClosePanel,
          footer: <BatchFooter actions={<button type="button">Convert</button>} />,
        }),
      )

    it("closes it when it lands on nothing in particular", async () => {
      const onClosePanel = vi.fn()
      const { user } = openShell(onClosePanel)
      await user.click(screen.getByTestId("body"))
      expect(onClosePanel).toHaveBeenCalledOnce()
    })

    it("leaves it open when it lands on a button, which has a job of its own", async () => {
      // Pressing Convert converts. It does not also close the panel — one
      // press, one thing, or the button becomes something people avoid.
      const onClosePanel = vi.fn()
      const { user } = openShell(onClosePanel)
      await user.click(screen.getByRole("button", { name: "Convert" }))
      expect(onClosePanel).not.toHaveBeenCalled()
    })

    it("leaves it open when it lands in a text box", async () => {
      const onClosePanel = vi.fn()
      const { user } = render(
        shell({
          panel,
          closePanelOnPressOutside: true,
          onClosePanel,
          footer: <BatchFooter status={<input aria-label="Search" />} />,
        }),
      )
      await user.click(screen.getByLabelText("Search"))
      expect(onClosePanel).not.toHaveBeenCalled()
    })

    it("stays open on a press inside itself", async () => {
      const onClosePanel = vi.fn()
      const { user } = openShell(onClosePanel)
      await user.click(screen.getByTestId("panel"))
      expect(onClosePanel).not.toHaveBeenCalled()
    })

    it("survives a press on a menu it opened, which renders outside it", async () => {
      const onClosePanel = vi.fn()
      const { user } = render(
        shell({
          closePanelOnPressOutside: true,
          onClosePanel,
          panel: (
            <>
              {panel}
              {createPortal(<button type="button">currency</button>, document.body)}
            </>
          ),
        }),
      )
      // Picking a type must not shut the editor the type belongs to.
      await user.click(screen.getByRole("button", { name: "currency" }))
      expect(onClosePanel).not.toHaveBeenCalled()
    })
  })

  it("holds a panel that is the screen open through a press beside it", async () => {
    const onClosePanel = vi.fn()
    const { user } = render(shell({ panel, onClosePanel }))
    await user.click(screen.getByTestId("body"))
    expect(onClosePanel).not.toHaveBeenCalled()
  })
})
