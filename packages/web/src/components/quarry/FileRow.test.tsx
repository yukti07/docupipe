import { describe, expect, it, vi } from "vitest"
import { GatedButton } from "@/components/common/GatedButton"
import { render, screen } from "@/test/render"
import { FileList } from "./FileList"
import { FileRow, type FileRowState } from "./FileRow"

describe("FileRow", () => {
  it.each([
    ["staged", "Staged"],
    ["checking", "Checking"],
    ["rejected", "Rejected"],
    ["uploading", "Uploading"],
    ["failed", "Upload failed"],
    ["uploaded", "Uploaded"],
    ["reading-shape", "Reading shape"],
    ["shape-ready", "Shape ready"],
    ["no-shape", "No table found"],
    ["unreadable", "Couldn't read it"],
  ] as [FileRowState, string][])("names the %s state on screen", (state, label) => {
    render(<FileRow name="invoice-1044.pdf" state={state} />)
    expect(screen.getByText(label)).toBeVisible()
  })

  it("carries the S04 states too, because it is one component on both screens", () => {
    render(<FileRow name="invoice-1044.pdf" state="paused" />)
    expect(screen.getByText("Paused")).toBeVisible()
  })

  it("shows a per-file bar while that file is uploading", () => {
    render(
      <FileRow
        name="invoice-1044.pdf"
        state="uploading"
        progress={{ loaded: 512, total: 1024 }}
      />,
    )
    expect(screen.getByRole("progressbar", { name: /invoice-1044/ })).toHaveAttribute(
      "aria-valuenow",
      "50",
    )
  })

  it("drops the bar the moment the file has landed", () => {
    render(
      <FileRow
        name="invoice-1044.pdf"
        state="shape-ready"
        progress={{ loaded: 512, total: 1024 }}
      />,
    )
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
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
        state="reading-shape"
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
