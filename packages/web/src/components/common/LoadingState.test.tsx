import { describe, expect, it } from "vitest"
import { render, screen } from "@/test/render"
import { LoadingState } from "./LoadingState"

describe("LoadingState", () => {
  it("always renders its label, so a wordless spinner cannot be shipped", () => {
    render(<LoadingState label="Reading this file" />)
    expect(screen.getByText("Reading this file")).toBeInTheDocument()
  })

  it("announces politely without stealing focus", () => {
    render(<LoadingState label="Waking up" />)
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite")
  })

  it("shows a determinate bar when it knows the fraction", () => {
    render(<LoadingState label="Uploading" value={7} of={10} />)
    const bar = screen.getByRole("progressbar")
    expect(bar).toHaveAttribute("aria-valuenow", "7")
    expect(bar).toHaveAttribute("aria-valuemax", "10")
  })

  it("has no progressbar when it does not know the fraction", () => {
    render(<LoadingState label="Reading this file" />)
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })
})
