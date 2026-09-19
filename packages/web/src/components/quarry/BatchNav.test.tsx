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

  it("never links Convert, because there is no screen behind it", () => {
    const { rerender, container } = render(
      <BatchNav requestId={REQUEST} current="files" done={settled} phase="prepare" />,
    )
    expect(screen.queryByRole("link", { name: "Convert" })).not.toBeInTheDocument()
    expect(stepState(container, "convert")).toBe("locked")

    rerender(<BatchNav requestId={REQUEST} current="results" done={settled} phase="converted" />)
    expect(screen.queryByRole("link", { name: "Converted" })).not.toBeInTheDocument()
    expect(stepState(container, "convert")).toBe("locked")
  })

  it("names the gate by what it is doing, and never by a number", () => {
    const { rerender } = render(
      <BatchNav requestId={REQUEST} current="files" done={settled} phase="prepare" />,
    )
    expect(screen.getByText("Convert")).toBeVisible()

    rerender(<BatchNav requestId={REQUEST} current="results" done={settled} phase="converting" />)
    expect(screen.getByText("Converting")).toBeVisible()

    rerender(<BatchNav requestId={REQUEST} current="results" done={settled} phase="converted" />)
    expect(screen.getByText("Converted")).toBeVisible()
  })

  it("carries no step numbers at all", () => {
    const { container } = render(
      <BatchNav requestId={REQUEST} current="files" done={settled} phase="prepare" />,
    )
    for (const digit of ["1", "2", "3", "4"]) {
      expect(container.querySelector("nav")).not.toHaveTextContent(new RegExp(`\\b${digit}\\b`))
    }
  })

  it("marches the rules either side of Convert only while it is converting", () => {
    const { container, rerender } = render(
      <BatchNav requestId={REQUEST} current="results" done={settled} phase="converting" />,
    )
    expect(container.querySelectorAll(".rail-dashes")).toHaveLength(2)

    rerender(<BatchNav requestId={REQUEST} current="results" done={settled} phase="converted" />)
    expect(container.querySelectorAll(".rail-dashes")).toHaveLength(0)
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

  it("gives the thing actually open a chip of its own", () => {
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
    expect(name.className).toContain("rounded-full")
    expect(name.className).toContain("bg-muted")
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
