import { describe, expect, it } from "vitest"
import { act, render, screen, waitFor } from "@/test/render"
import { WorkspaceProvider, switchWorkspace, useWorkspace, type WorkspaceBatch } from "./workspace"

const batch = (requestId: string, createdAt: string): WorkspaceBatch => ({
  requestId,
  name: `Batch ${requestId}`,
  createdAt,
  fileCount: 3,
  phase: "prepare",
  summary: {},
})

function Probe() {
  const { batches, loaded, addBatch, updateBatch, removeBatch } = useWorkspace()
  return (
    <div>
      <span data-testid="loaded">{String(loaded)}</span>
      <ol data-testid="list">
        {batches.map((b) => (
          <li key={b.requestId}>
            {b.requestId}:{b.phase}
          </li>
        ))}
      </ol>
      <button onClick={() => addBatch(batch("req_new", "2026-09-14T12:00:00Z"))}>add</button>
      <button onClick={() => updateBatch("req_a", { phase: "converting" })}>convert a</button>
      <button onClick={() => removeBatch("req_a")}>remove a</button>
    </div>
  )
}

const ids = () =>
  [...screen.getByTestId("list").querySelectorAll("li")].map((li) => li.textContent)

describe("WorkspaceProvider", () => {
  it("round-trips through localStorage", async () => {
    localStorage.setItem(
      "quarry.workspace",
      JSON.stringify([batch("req_a", "2026-09-14T10:00:00Z")]),
    )
    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    )
    await waitFor(() => expect(ids()).toEqual(["req_a:prepare"]))
  })

  it("lists newest first", async () => {
    localStorage.setItem(
      "quarry.workspace",
      JSON.stringify([
        batch("req_old", "2026-09-01T10:00:00Z"),
        batch("req_newer", "2026-09-13T10:00:00Z"),
      ]),
    )
    const { user } = render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    )
    await waitFor(() => expect(ids()).toHaveLength(2))
    await user.click(screen.getByRole("button", { name: "add" }))
    await waitFor(() =>
      expect(ids()).toEqual(["req_new:prepare", "req_newer:prepare", "req_old:prepare"]),
    )
  })

  it("survives a corrupt value with an empty list rather than a thrown page", async () => {
    localStorage.setItem("quarry.workspace", "{not json at all")
    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    )
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("true"))
    expect(ids()).toEqual([])
  })

  it("updates and removes one batch without touching the others", async () => {
    localStorage.setItem(
      "quarry.workspace",
      JSON.stringify([
        batch("req_a", "2026-09-14T10:00:00Z"),
        batch("req_b", "2026-09-13T10:00:00Z"),
      ]),
    )
    const { user } = render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    )
    await waitFor(() => expect(ids()).toHaveLength(2))

    await user.click(screen.getByRole("button", { name: "convert a" }))
    await waitFor(() => expect(ids()).toEqual(["req_a:converting", "req_b:prepare"]))

    await user.click(screen.getByRole("button", { name: "remove a" }))
    await waitFor(() => expect(ids()).toEqual(["req_b:prepare"]))
    expect(JSON.parse(localStorage.getItem("quarry.workspace") ?? "[]")).toHaveLength(1)
  })

  it("takes the list with the identity it belongs to, and brings it back", async () => {
    localStorage.setItem(
      "quarry.workspace",
      JSON.stringify([batch("req_a", "2026-09-14T10:00:00Z")]),
    )
    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    )
    await waitFor(() => expect(ids()).toEqual(["req_a:prepare"]))

    // A ?w= link adopted someone else's workspace. Their id has no rows for
    // req_a, so a card for it would open onto nothing.
    await act(async () => switchWorkspace("usr_mine", "usr_theirs"))
    await waitFor(() => expect(ids()).toEqual([]))

    // And the link back to the old id is not a one-way door.
    await act(async () => switchWorkspace("usr_theirs", "usr_mine"))
    await waitFor(() => expect(ids()).toEqual(["req_a:prepare"]))
  })

  it("keeps a batch that is already there from being listed twice", async () => {
    const { user } = render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    )
    await act(async () => {})
    await user.click(screen.getByRole("button", { name: "add" }))
    await user.click(screen.getByRole("button", { name: "add" }))
    await waitFor(() => expect(ids()).toEqual(["req_new:prepare"]))
  })
})
