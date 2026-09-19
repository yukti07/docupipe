import { describe, expect, it } from "vitest"
import { render, screen, within } from "@/test/render"
import { AllowanceMeter } from "./AllowanceMeter"
import { AppHeader } from "./AppHeader"

describe("AllowanceMeter", () => {
  it("shows used against the limit, grouped and in tabular mono", () => {
    const { container } = render(<AllowanceMeter used={1840} limit={5000} />)
    const figure = screen.getByText("1,840 / 5,000")
    expect(figure).toBeVisible()
    expect(figure.className).toContain("font-mono")
    expect(figure.className).toContain("tabular-nums")
    expect(container.querySelector("[role=progressbar]")).toHaveAttribute("aria-valuenow", "1840")
  })

  it("offers Raise the cap only beside the pause it would relieve", () => {
    const { rerender } = render(<AllowanceMeter used={10} limit={100} />)
    expect(screen.queryByRole("button", { name: "Raise the cap" })).not.toBeInTheDocument()
    rerender(<AllowanceMeter used={10} limit={100} raiseCap />)
    expect(screen.getByRole("button", { name: "Raise the cap" })).toBeVisible()
  })

  it("says the cap cannot be raised yet, and what happens instead", async () => {
    const { user } = render(
      <AllowanceMeter used={5000} limit={5000} resetsAt="2026-09-15T00:00:00Z" raiseCap />,
    )
    await user.click(screen.getByRole("button", { name: "Raise the cap" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText(/can't be raised yet/)).toBeVisible()
    expect(within(dialog).getByText(/The allowance resets at \d{2}:\d{2}/)).toBeVisible()
    expect(within(dialog).getByText(/stays open and downloadable/)).toBeVisible()
  })
})

describe("AppHeader", () => {
  it("is the product's name and the screen's own bar, and nothing else", () => {
    render(
      <AppHeader>
        <div data-testid="rail">rail</div>
      </AppHeader>,
    )
    expect(screen.getByRole("link", { name: "Quarry" })).toHaveAttribute("href", "/")
    expect(screen.getByTestId("rail")).toBeVisible()
  })

  it("carries no allowance meter — the figure belongs beside the pause it explains", () => {
    render(<AppHeader />)
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    expect(screen.queryByText(/Pages today/i)).not.toBeInTheDocument()
  })

  it("carries no workspace link", () => {
    render(<AppHeader />)
    expect(screen.queryByRole("button", { name: /Workspace link/ })).not.toBeInTheDocument()
  })
})
