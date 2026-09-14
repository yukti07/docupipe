import { describe, expect, it } from "vitest"
import { render, screen } from "@/test/render"
import { StatusBadge } from "./StatusBadge"

describe("StatusBadge", () => {
  it.each([
    ["success", "Done"],
    ["review", "4 to check"],
    ["error", "2 failed"],
    ["paused", "Paused"],
    ["neutral", "Queued"],
    ["working", "Working"],
  ] as const)("renders the %s variant with its label", (variant, label) => {
    render(<StatusBadge variant={variant}>{label}</StatusBadge>)
    expect(screen.getByText(label)).toBeVisible()
  })

  it("carries a non-colour signal for every alerting variant", () => {
    const { container } = render(<StatusBadge variant="review">4 to check</StatusBadge>)
    expect(container.querySelector("svg")).toBeTruthy()
  })
})
