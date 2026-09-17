import { describe, expect, it, vi } from "vitest"
import { GatedButton } from "@/components/common/GatedButton"
import { render, screen } from "@/test/render"
import { FileList } from "./FileList"
import { FileRow, type FileRowState } from "./FileRow"

describe("FileRow", () => {
  it.each([
    ["staged", "In line"],
    // Signing is the start of the upload, not a queue in front of it.
    ["checking", "Uploading"],
    ["rejected", "Rejected"],
    ["uploading", "Uploading"],
    ["failed", "Upload failed"],
    ["uploaded", "Uploaded"],
  ] as [FileRowState, string][])("names the %s state on screen", (state, label) => {
    render(<FileRow name="invoice-1044.pdf" state={state} />)
    expect(screen.getByText(label)).toBeVisible()
  })

  it("says nothing about a schema — that belongs to the eye beside it", () => {
    render(<FileRow name="invoice-1044.pdf" state="uploaded" />)
    expect(screen.queryByText(/shape/i)).not.toBeInTheDocument()
    expect(screen.queryByText("Checking")).not.toBeInTheDocument()
  })

  it("carries the S04 states too, because it is one component on both screens", () => {
    render(<FileRow name="invoice-1044.pdf" state="paused" />)
    expect(screen.getByText("Paused")).toBeVisible()
  })

  it("leaves progress to the spinner and the batch bar, not a bar per row", () => {
    render(<FileRow name="invoice-1044.pdf" state="uploading" />)
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    expect(screen.getByText("Uploading")).toBeVisible()
  })

  it("owns its own retry", async () => {
    const onRetry = vi.fn()
    const { user } = render(<FileRow name="a.pdf" state="failed" onRetry={onRetry} />)
    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("states the reason on the row, never a raw error string", () => {
    render(
      <FileRow
        name="q3-archive.zip"
        state="rejected"
        failure={{ class: "archive_not_expanded", message: "q3-archive.zip — unzip it first." }}
      />,
    )
    expect(screen.getByText(/unzip it first/i)).toBeVisible()
  })

  it("shows the folder a file came from, and its size", () => {
    render(
      <FileRow
        name="invoice-1043.pdf"
        location="Q3 invoices/invoice-1043.pdf"
        size={2048}
        state="uploaded"
      />,
    )
    expect(screen.getByText(/Q3 invoices · 2\.0 KB/)).toBeVisible()
  })

  it("keeps the trailing control present from the first frame, disabled until it works", () => {
    render(
      <FileRow
        name="invoice-1043.pdf"
        state="uploaded"
        trailing={
          <GatedButton reason="Still reading this file's shape">Preview / Edit</GatedButton>
        }
      />,
    )
    expect(
      screen.getByRole("button", { name: /Preview \/ Edit.*Still reading/ }),
    ).toBeDisabled()
  })
})

describe("FileList", () => {
  it("puts the honest summary above the rows", () => {
    render(
      <FileList summary={<span>6 of 6 uploaded · 5 schemas back</span>}>
        <FileRow name="a.pdf" state="uploaded" />
      </FileList>,
    )
    expect(screen.getByText("6 of 6 uploaded · 5 schemas back")).toBeVisible()
  })
})
