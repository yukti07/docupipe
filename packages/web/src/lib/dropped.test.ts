import { describe, expect, it } from "vitest"
import { filesFromDrop } from "./dropped"

/* ------------------------------------------------------------------ */
/* A stand-in for the entries API, which jsdom does not implement      */
/* ------------------------------------------------------------------ */

type Node = { name: string; children?: Node[]; unreadable?: boolean }

const file = (name: string): Node => ({ name })
const dir = (name: string, children: Node[]): Node => ({ name, children })

function entryOf(node: Node): unknown {
  if (!node.children) {
    return {
      isFile: true,
      isDirectory: false,
      name: node.name,
      file: (onFile: (f: File) => void, onError: (e: unknown) => void) =>
        node.unreadable
          ? onError(new Error("gone"))
          : onFile(new File(["xyz"], node.name, { type: "application/pdf" })),
    }
  }

  return {
    isFile: false,
    isDirectory: true,
    name: node.name,
    createReader() {
      // The real reader answers in batches of at most 100 and gives no hint
      // that more are waiting. Anything that reads it once is wrong.
      let sent = 0
      return {
        readEntries(onEntries: (e: unknown[]) => void) {
          const batch = node.children!.slice(sent, sent + 100).map(entryOf)
          sent += batch.length
          onEntries(batch)
        },
      }
    },
  }
}

function drop(nodes: Node[], options: { entriesApi?: boolean; flat?: File[] } = {}): DataTransfer {
  const entriesApi = options.entriesApi ?? true
  return {
    items: nodes.map((node) => ({
      kind: "file",
      webkitGetAsEntry: entriesApi ? () => entryOf(node) : undefined,
      getAsFile: () => new File(["xyz"], node.name),
    })),
    files: options.flat ?? [],
  } as unknown as DataTransfer
}

const names = (files: File[]) => files.map((f) => f.name)
const paths = (files: File[]) =>
  files.map((f) => (f as File & { webkitRelativePath: string }).webkitRelativePath)

/* ------------------------------------------------------------------ */

describe("filesFromDrop", () => {
  it("returns a plainly dropped file", async () => {
    const files = await filesFromDrop(drop([file("invoice-1043.pdf")]))
    expect(names(files)).toEqual(["invoice-1043.pdf"])
  })

  it("walks a dropped folder instead of refusing it as an empty file", async () => {
    const files = await filesFromDrop(
      drop([dir("q3", [file("a.pdf"), file("b.pdf"), file("c.pdf")])]),
    )
    expect(names(files)).toEqual(["a.pdf", "b.pdf", "c.pdf"])
    for (const f of files) expect(f.size).toBeGreaterThan(0)
  })

  it("labels each file with its path inside the folder", async () => {
    const files = await filesFromDrop(
      drop([dir("q3", [dir("north", [file("a.pdf")]), file("b.pdf")])]),
    )
    expect(paths(files)).toEqual(["q3/north/a.pdf", "q3/b.pdf"])
  })

  it("reads past the reader's hundred-entry batch", async () => {
    const many = Array.from({ length: 250 }, (_, i) => file(`doc-${i}.pdf`))
    const files = await filesFromDrop(drop([dir("big", many)]))
    expect(files).toHaveLength(250)
  })

  it("takes a mixed drop of folders and loose files", async () => {
    const files = await filesFromDrop(
      drop([file("loose.pdf"), dir("folder", [file("inside.pdf")])]),
    )
    expect(names(files)).toEqual(["loose.pdf", "inside.pdf"])
  })

  it("keeps the rest when one file cannot be read", async () => {
    const files = await filesFromDrop(
      drop([dir("q3", [file("a.pdf"), { name: "gone.pdf", unreadable: true }, file("c.pdf")])]),
    )
    expect(names(files)).toEqual(["a.pdf", "c.pdf"])
  })

  it("answers with nothing for a folder that holds nothing", async () => {
    expect(await filesFromDrop(drop([dir("empty", [])]))).toEqual([])
  })

  it("stops rather than recurses forever on a folder that contains itself", async () => {
    const loop: Node = { name: "loop", children: [] }
    loop.children!.push(loop, file("a.pdf"))
    const files = await filesFromDrop(drop([loop]))
    expect(files.length).toBeGreaterThan(0)
    expect(files.length).toBeLessThan(100)
  })

  it("falls back to the flat list where there is no entries API", async () => {
    const flat = [new File(["x"], "legacy.pdf")]
    const files = await filesFromDrop(drop([file("legacy.pdf")], { entriesApi: false, flat }))
    expect(names(files)).toEqual(["legacy.pdf"])
  })

  it("takes an absent DataTransfer without throwing", async () => {
    expect(await filesFromDrop(null)).toEqual([])
  })
})
