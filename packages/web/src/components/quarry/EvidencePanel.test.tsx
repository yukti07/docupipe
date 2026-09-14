import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@/test/render"
import type { Locator } from "@/lib/api/types"
import { EvidencePanel } from "./EvidencePanel"
import { EvidenceView } from "./EvidenceView"
import { HighlightBox } from "./HighlightBox"

// The page view drives pdf.js and a canvas, neither of which jsdom has. Its
// own contract — fractional box in, positioned box out — is covered by
// HighlightBox below.
vi.mock("./EvidencePageView", () => ({
  EvidencePageView: ({ locator }: { locator: Extract<Locator, { type: "page" }> }) => (
    <div data-testid="page-view">
      page {locator.page} of {locator.pageCount}
    </div>
  ),
}))

describe("HighlightBox", () => {
  it("positions itself from fractions of the page, not from points", () => {
    const { container } = render(
      <HighlightBox box={{ x: 0.7697, y: 0.4276, w: 0.0924, h: 0.019 }} />,
    )
    const box = container.firstElementChild as HTMLElement
    expect(box.style.left).toBe("76.97%")
    expect(box.style.top).toBe("42.76%")
    expect(box.style.width).toBe("9.24%")
    expect(box.style.height).toBe("1.9%")
  })

  it("draws itself only where motion is welcome, and is never a solid overlay", () => {
    const { container } = render(<HighlightBox box={{ x: 0.1, y: 0.1, w: 0.2, h: 0.05 }} />)
    const box = container.firstElementChild as HTMLElement
    expect(box.className).toContain("motion-safe:animate-[evidence-draw_400ms_ease-out]")
    expect(box.className).toContain("bg-primary/12")
  })
})

describe("EvidenceView", () => {
  it("dispatches a page locator to the page view", () => {
    render(
      <EvidenceView
        locator={{
          type: "page",
          documentUrl: "/fixtures/invoice-1044.pdf",
          page: 2,
          pageCount: 3,
          box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
        }}
      />,
    )
    expect(screen.getByTestId("page-view")).toHaveTextContent("page 2 of 3")
  })

  it("cues a recording to the moment, and admits the speaker is inferred", () => {
    render(
      <EvidenceView
        locator={{
          type: "audio",
          audioUrl: "/fixtures/call-0912.m4a",
          startMs: 74200,
          endMs: 78600,
          transcript: "…the invoice came in from Velle Chemicals…",
          speaker: "Second speaker",
          speakerInferred: true,
        }}
      />,
    )
    expect(screen.getByText("1:14 – 1:18 · Second speaker")).toBeVisible()
    expect(screen.getByLabelText("The moment this value was said")).toHaveAttribute(
      "src",
      "/fixtures/call-0912.m4a#t=74.2,78.6",
    )
    expect(screen.getByText(/worked out from the recording/)).toBeVisible()
  })

  it("highlights the phrase inside its paragraph", () => {
    render(
      <EvidenceView
        locator={{
          type: "text",
          paragraph: "Invoice from Northgate Paper for the quarter.",
          start: 13,
          end: 28,
        }}
      />,
    )
    expect(screen.getByText("Northgate Paper").tagName).toBe("MARK")
  })

  it("names the sheet, row and column for a spreadsheet", () => {
    render(
      <EvidenceView
        locator={{ type: "record", path: "credit-notes.xlsx", sheet: "Totals", row: 3, column: "D" }}
      />,
    )
    expect(screen.getByText("credit-notes.xlsx")).toBeVisible()
    expect(screen.getByText("Totals")).toBeVisible()
    expect(screen.getByText("D")).toBeVisible()
  })

  it("says plainly when a format cannot report a position, and shows the text instead", () => {
    const { container } = render(
      <EvidenceView
        locator={{
          type: "none",
          sourceText: "Ferro Castings Ltd · INV-1046 · Net 1,615.00",
          reason: "This page has no date on it, so there is no position to point at.",
        }}
      />,
    )
    expect(screen.getByText(/can't say where the value was/)).toBeVisible()
    expect(screen.getByText(/no position to point at/)).toBeVisible()
    expect(screen.getByText(/Ferro Castings Ltd/)).toBeVisible()
    // No box is drawn when we are not sure where it goes.
    expect(container.querySelector('[role="img"]')).toBeNull()
  })
})

describe("EvidencePanel", () => {
  it("opens for an ordinary value, not only a marked one", async () => {
    render(
      <EvidencePanel valueId="val_r1_total" fileName="invoice-1044.pdf" onClose={vi.fn()} />,
    )
    expect(screen.getByText("Finding the source")).toBeVisible()
    await waitFor(() => expect(screen.getByTestId("page-view")).toBeVisible())
    expect(screen.getByText("1488.00")).toBeVisible()
  })

  it("shows the reason on a marked value", async () => {
    render(<EvidencePanel valueId="val_r5_vat" fileName="invoice-1044.pdf" onClose={vi.fn()} />)
    expect(await screen.findByText(/216\.40, and that is what was recorded/)).toBeVisible()
  })

  it("says it is read-only, and what to do instead", async () => {
    render(<EvidencePanel valueId="val_r5_vat" fileName="invoice-1044.pdf" onClose={vi.fn()} />)
    expect(screen.getByText(/download the table and edit it there/)).toBeVisible()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  })

  it("closes on the close control", async () => {
    const onClose = vi.fn()
    const { user } = render(
      <EvidencePanel valueId="val_r5_vat" fileName="invoice-1044.pdf" onClose={onClose} />,
    )
    await user.click(screen.getByRole("button", { name: "Close the evidence panel" }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
