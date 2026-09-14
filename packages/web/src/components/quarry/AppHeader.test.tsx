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
  it("says plainly that the link carries the whole workspace", async () => {
    const { user } = render(<AppHeader userId="usr_abc" />)
    await user.click(screen.getByRole("button", { name: /Workspace link/ }))
    expect(screen.getByText(/lives in this browser/i)).toBeVisible()
    expect(screen.getByText(/anyone who holds it can open every batch/i)).toBeVisible()
  })

  it("offers the workspace url with the user id on it", async () => {
    const { user } = render(<AppHeader userId="usr_abc" />)
    await user.click(screen.getByRole("button", { name: /Workspace link/ }))
    expect(screen.getByLabelText("Workspace link")).toHaveValue(
      `${window.location.origin}/?w=usr_abc`,
    )
  })

  it("copies that url to the clipboard", async () => {
    const { user } = render(<AppHeader userId="usr_abc" />)
    await user.click(screen.getByRole("button", { name: /Workspace link/ }))
    await user.click(screen.getByRole("button", { name: "Copy" }))
    await expect(navigator.clipboard.readText()).resolves.toBe(
      `${window.location.origin}/?w=usr_abc`,
    )
    expect(screen.getByRole("button", { name: "Copied" })).toBeVisible()
  })

  it("shows no meter before a batch has ever reported an allowance", () => {
    render(<AppHeader userId="usr_abc" />)
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })

  it("shows the live allowance when a poll has one", () => {
    render(
      <AppHeader
        userId="usr_abc"
        allowance={{ used: 1840, limit: 5000, resetsAt: "2026-09-15T00:00:00Z" }}
      />,
    )
    expect(screen.getByText("1,840 / 5,000")).toBeVisible()
  })
})
