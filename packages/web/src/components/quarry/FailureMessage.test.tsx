import { describe, expect, it } from "vitest"
import { render, screen } from "@/test/render"
import { FailureMessage } from "./FailureMessage"

describe("FailureMessage", () => {
  it("shows the sentence and the next step", () => {
    render(<FailureMessage failure={{ class: "format_locked" }} />)
    expect(screen.getByText(/password protected/i)).toBeVisible()
    expect(screen.getByText(/Remove the password/i)).toBeVisible()
  })

  it("renders a quota pause in the paused tone, not the error tone", () => {
    const { container } = render(<FailureMessage failure={{ class: "provider_quota_exhausted" }} />)
    expect(container.firstElementChild?.className).toContain("paused")
    expect(container.firstElementChild?.className).not.toContain("error-bg")
  })

  it("compact mode drops the next step but keeps the sentence", () => {
    render(<FailureMessage failure={{ class: "extract_empty" }} compact />)
    expect(screen.getByText(/images with no readable text/i)).toBeVisible()
    expect(screen.queryByText(/convert anyway/i)).not.toBeInTheDocument()
  })
})
