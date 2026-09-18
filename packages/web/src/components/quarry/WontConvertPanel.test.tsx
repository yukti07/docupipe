import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@/test/render"
import { WontConvertPanel } from "./WontConvertPanel"

const entry = (fileId: string, fileName: string) => ({
  fileId,
  fileName,
  failure: {
    class: "format_unsupported" as const,
    message: "Schema detection does not support application/pdf",
    nextStep: "Save it as PDF, .docx, .xlsx or CSV and upload it again.",
  },
})

describe("WontConvertPanel", () => {
  it("renders nothing when every file found a shape", () => {
    const { container } = render(<WontConvertPanel entries={[]} onDiscard={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("names the file and the reason", () => {
    render(<WontConvertPanel entries={[entry("file_1", "sample_document.pdf")]} />)
    expect(screen.getByText("sample_document.pdf")).toBeVisible()
    expect(screen.getByText(/Save it as PDF/)).toBeVisible()
  })

  it("discards one file, and hands back only that file's id", async () => {
    const onDiscard = vi.fn().mockResolvedValue(undefined)
    const { user } = render(
      <WontConvertPanel
        entries={[entry("file_1", "one.pdf"), entry("file_2", "two.pdf")]}
        onDiscard={onDiscard}
      />,
    )

    const rows = screen.getAllByRole("button", { name: "Discard" })
    await user.click(rows[0])
    expect(onDiscard).toHaveBeenCalledWith(["file_1"])
  })

  it("discards the lot in one press, once there is more than one", async () => {
    const onDiscard = vi.fn().mockResolvedValue(undefined)
    const { user } = render(
      <WontConvertPanel
        entries={[entry("file_1", "one.pdf"), entry("file_2", "two.pdf")]}
        onDiscard={onDiscard}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Discard all 2" }))
    expect(onDiscard).toHaveBeenCalledWith(["file_1", "file_2"])
  })

  it("offers no discard-all for a single file — the row's own button is the one", () => {
    render(<WontConvertPanel entries={[entry("file_1", "one.pdf")]} onDiscard={vi.fn()} />)
    expect(screen.queryByRole("button", { name: /Discard all/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Discard" })).toBeVisible()
  })

  it("offers nothing to press once there is no discarding to be done", () => {
    // Converting has started: the files are on their way and cannot be taken
    // out any more, so the panel is a report rather than a control.
    render(<WontConvertPanel entries={[entry("file_1", "one.pdf")]} />)
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})
