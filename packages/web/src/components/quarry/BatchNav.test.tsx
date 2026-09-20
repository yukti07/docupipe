import { describe, expect, it } from "vitest"
import { render, screen } from "@/test/render"
import { BatchNav, railPhase } from "./BatchNav"

const REQUEST = "req_01KABC"

const settled = { files: true, schemas: true }

function stepEl(container: HTMLElement, step: string): Element | null {
  return container.querySelector(`[data-step="${step}"]`)
}

function stepState(container: HTMLElement, step: string): string | null {
  return stepEl(container, step)?.getAttribute("data-state") ?? null
}

describe("BatchNav", () => {
  it("lights the screen you are on rather than the furthest step you have reached", () => {
    // Every file is up and every shape is back, and the screen is still Files
    // — because Review schemas has not been pressed.
    const { container } = render(
      <BatchNav requestId={REQUEST} current="files" done={settled} phase="prepare" />,
    )
    expect(stepState(container, "files")).toBe("current")
    expect(stepState(container, "schemas")).toBe("done")
  })

  it("moves to Schemas only on the screen that is Review schemas", () => {
    const { container } = render(
      <BatchNav requestId={REQUEST} current="schemas" done={settled} phase="prepare" />,
    )
    expect(stepState(container, "schemas")).toBe("current")
    expect(stepEl(container, "schemas")).toHaveAttribute("aria-current", "step")
    expect(screen.queryByRole("link", { name: "Schemas" })).not.toBeInTheDocument()
  })

  it("links the steps that are not the one you are on", () => {
    render(<BatchNav requestId={REQUEST} current="schemas" done={settled} phase="prepare" />)
    expect(screen.getByRole("link", { name: "Files" })).toHaveAttribute(
      "href",
      `/request/${REQUEST}`,
    )
  })

  // The gate used to hold a step of its own, padlocked on both sides and
  // renamed as the batch crossed it. It was a place in the rail that was never
  // anywhere you could be, and it outlived the work it named.
  it("keeps three steps and no fourth place that is not a screen", () => {
    const { container } = render(
      <BatchNav requestId={REQUEST} current="files" done={settled} phase="prepare" />,
    )
    expect(container.querySelectorAll("li[data-step]")).toHaveLength(3)
    expect(container.querySelector('[data-step="convert"]')).toBeNull()
    expect(screen.queryByText("Convert")).not.toBeInTheDocument()
    expect(screen.queryByText("Converted")).not.toBeInTheDocument()
    expect(container.querySelector("svg.lucide-lock")).toBeNull()
  })

  it("names the crossing between Schemas and Results, and only while it lasts", () => {
    const { container, rerender } = render(
      <BatchNav requestId={REQUEST} current="results" done={settled} phase="converting" />,
    )
    expect(screen.getByText("converting")).toBeVisible()
    expect(container.querySelector('[data-marker="converting"]')).not.toBeNull()

    rerender(<BatchNav requestId={REQUEST} current="results" done={settled} phase="converted" />)
    expect(screen.queryByText("converting")).not.toBeInTheDocument()
  })

  // Pressing Review Schemas is what makes the wait something anyone is
  // watching, so the screen that did it is the screen that says so.
  it("names detecting between Files and Schemas, only when a screen asks for it", () => {
    const { container, rerender } = render(
      <BatchNav requestId={REQUEST} current="schemas" done={settled} phase="prepare" detecting />,
    )
    expect(screen.getByText("detecting")).toBeVisible()
    expect(container.querySelector('[data-marker="detecting"]')).not.toBeNull()

    rerender(<BatchNav requestId={REQUEST} current="schemas" done={settled} phase="prepare" />)
    expect(screen.queryByText("detecting")).not.toBeInTheDocument()
  })

  it("animates the rules either side of a marker", () => {
    const { container } = render(
      <BatchNav requestId={REQUEST} current="schemas" done={settled} phase="prepare" detecting />,
    )
    expect(container.querySelectorAll(".rail-crawl")).toHaveLength(2)
  })

  it("ticks Results once the batch has results, and not before", () => {
    const ticked = (container: HTMLElement, step: string) =>
      Boolean(stepEl(container, step)?.querySelector("svg.lucide-check"))

    // Mid-conversion the step already reads "done" — it is behind you in the
    // sense that you are past the gate — but nothing has come back yet.
    const { container, rerender } = render(
      <BatchNav requestId={REQUEST} current="schemas" done={settled} phase="converting" />,
    )
    expect(stepState(container, "results")).toBe("done")
    expect(ticked(container, "results")).toBe(false)
    expect(ticked(container, "files")).toBe(true)

    rerender(<BatchNav requestId={REQUEST} current="schemas" done={settled} phase="converted" />)
    expect(ticked(container, "results")).toBe(true)
  })

  it("never ticks the step you are standing on", () => {
    const { container } = render(
      <BatchNav requestId={REQUEST} current="results" done={settled} phase="converted" />,
    )
    expect(stepState(container, "results")).toBe("current")
    expect(stepEl(container, "results")?.querySelector("svg.lucide-check")).toBeNull()
  })

  it("carries no step numbers at all", () => {
    const { container } = render(
      <BatchNav requestId={REQUEST} current="files" done={settled} phase="prepare" />,
    )
    for (const digit of ["1", "2", "3"]) {
      expect(container.querySelector("nav")).not.toHaveTextContent(new RegExp(`\\b${digit}\\b`))
    }
  })

  it("leaves Results out of reach until there is something behind it", () => {
    const { container } = render(
      <BatchNav
        requestId={REQUEST}
        current="files"
        done={{ files: false, schemas: false }}
        phase="prepare"
      />,
    )
    expect(screen.queryByRole("link", { name: "Results" })).not.toBeInTheDocument()
    expect(stepState(container, "results")).toBe("upcoming")
  })

  it("keeps Files and Schemas reachable after the gate, for a read-only look back", () => {
    render(<BatchNav requestId={REQUEST} current="results" done={settled} phase="converted" />)
    // Files asks for itself by name, because the plain route now serves the
    // results rather than the drop.
    expect(screen.getByRole("link", { name: "Files" })).toHaveAttribute(
      "href",
      `/request/${REQUEST}?view=files`,
    )
    expect(screen.getByRole("link", { name: "Schemas" })).toHaveAttribute(
      "href",
      `/request/${REQUEST}/schemas`,
    )
  })

  it("links Results back to the batch from a screen underneath it", () => {
    render(
      <BatchNav
        requestId={REQUEST}
        current="results"
        done={settled}
        phase="converted"
        tail="Merge"
      />,
    )
    expect(screen.getByRole("link", { name: "Results" })).toHaveAttribute(
      "href",
      `/request/${REQUEST}`,
    )
  })

  it("keeps Results lit while you are inside it, and still linked", () => {
    // A table and the merge screen are parts *of* Results, not somewhere else.
    // Greying the step while one is open reads as having left it.
    const { container } = render(
      <BatchNav
        requestId={REQUEST}
        current="results"
        done={settled}
        phase="converted"
        tail="products.csv"
      />,
    )
    expect(stepState(container, "results")).toBe("current")
    expect(screen.getByRole("link", { name: "Results" })).toBeVisible()
  })

  it("leaves the thing actually open as plain text, not a fourth chip", () => {
    const { container } = render(
      <BatchNav
        requestId={REQUEST}
        current="results"
        done={settled}
        phase="converted"
        tail="products.csv"
      />,
    )
    const name = screen.getByText("products.csv")
    // A name is not a state. Given the steps' pill it read as a step, and
    // given their weight it shouted over the one thing that is lit.
    expect(name.className).not.toContain("bg-muted")
    expect(name.className).not.toContain("rounded-full")
    expect(name.className).not.toContain("font-medium")
    expect(stepEl(container, "tail")).toHaveAttribute("aria-current", "step")
  })

  it("marks the tail as where you are, not the step above it", () => {
    const { container } = render(
      <BatchNav
        requestId={REQUEST}
        current="results"
        done={settled}
        phase="converted"
        tail="Merge"
      />,
    )
    expect(stepEl(container, "tail")).toHaveAttribute("aria-current", "step")
    expect(stepEl(container, "results")).not.toHaveAttribute("aria-current")
  })

  it("carries no tail when Results is itself the screen", () => {
    const { container } = render(
      <BatchNav requestId={REQUEST} current="results" done={settled} phase="converted" />,
    )
    expect(stepEl(container, "tail")).toBeNull()
    expect(screen.queryByRole("link", { name: "Results" })).not.toBeInTheDocument()
    expect(stepEl(container, "results")).toHaveAttribute("aria-current", "step")
  })

  it("names itself, so the steps are reachable as a group", () => {
    render(<BatchNav requestId={REQUEST} current="files" done={settled} phase="prepare" />)
    expect(screen.getByRole("navigation", { name: "Batch" })).toBeVisible()
  })
})

describe("railPhase", () => {
  it("collapses the workspace's five phases onto the three the rail draws", () => {
    expect(railPhase(undefined)).toBe("prepare")
    expect(railPhase("prepare")).toBe("prepare")
    expect(railPhase("converting")).toBe("converting")
    // A pause is still mid-conversion: the dashes keep marching, because the
    // work has not finished and the results are not there to go to.
    expect(railPhase("paused")).toBe("converting")
    expect(railPhase("done")).toBe("converted")
    expect(railPhase("failed")).toBe("converted")
  })
})
