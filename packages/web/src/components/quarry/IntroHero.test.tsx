import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@/test/render"
import { IntroHero } from "./IntroHero"

afterEach(() => vi.useRealTimers())

describe("IntroHero", () => {
  it("shows what comes out, not just what goes in", () => {
    render(<IntroHero onDone={vi.fn()} />)
    expect(screen.getByRole("heading", { name: "Anything in. Tables out." })).toBeVisible()
    expect(screen.getByText("4 rows · 4 typed fields · ready to query")).toBeVisible()
  })

  it("gets out of the way on a click anywhere", () => {
    const onDone = vi.fn()
    render(<IntroHero onDone={onDone} />)
    fireEvent.click(screen.getByRole("dialog"))
    expect(onDone).toHaveBeenCalled()
  })

  // Something this size that swallows clicks cannot be mouse-only.
  it("gets out of the way on Escape", () => {
    const onDone = vi.fn()
    render(<IntroHero onDone={onDone} />)
    expect(screen.getByRole("dialog")).toHaveFocus()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(onDone).toHaveBeenCalled()
  })

  it("leaves on its own, so nobody has to dismiss it to use the page", () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    render(<IntroHero onDone={onDone} />)
    expect(onDone).not.toHaveBeenCalled()
    vi.advanceTimersByTime(8000)
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
