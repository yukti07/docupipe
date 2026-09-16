/**
 * What was actually dropped, folders walked.
 *
 * `DataTransfer.files` holds the things that were dropped, not the things they
 * contain: drop a folder and it holds one zero-byte entry standing for the
 * folder itself, which pre-flight then refuses as an empty file. The contents
 * are only reachable through the entries API, so a folder has to be walked.
 *
 * Two rules the entries API imposes, and both of them bite quietly:
 *
 *   - Every entry must be taken from the DataTransfer *synchronously*. It is
 *     emptied as soon as the drop handler returns, so nothing can be read from
 *     it after the first await.
 *   - `readEntries` answers with at most 100 entries at a time and says nothing
 *     about there being more. It has to be called until it answers with none,
 *     or a folder of 500 files quietly becomes a folder of 100.
 */

/** The parts of FileSystemEntry we use. It is not in lib.dom for older targets. */
type Entry = {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?: (onFile: (file: File) => void, onError: (error: unknown) => void) => void
  createReader?: () => {
    readEntries: (onEntries: (entries: Entry[]) => void, onError: (error: unknown) => void) => void
  }
}

/** Deep enough for any real folder, and a stop for a symlink that points at itself. */
const MAX_DEPTH = 24

export async function filesFromDrop(transfer: DataTransfer | null): Promise<File[]> {
  if (!transfer) return []

  // Synchronous, before anything is awaited — see the note above.
  const entries: Entry[] = []
  let sawItems = false
  for (const item of Array.from(transfer.items ?? [])) {
    if (item.kind !== "file") continue
    sawItems = true
    const entry = item.webkitGetAsEntry?.() as Entry | null
    if (entry) entries.push(entry)
  }

  // No entries API, or items that would not give one up. The flat list is then
  // everything there is to have, which is what the old behaviour was.
  if (!sawItems || entries.length === 0) return Array.from(transfer.files ?? [])

  const files: File[] = []
  for (const entry of entries) await collect(entry, "", 0, files)
  return files
}

async function collect(entry: Entry, prefix: string, depth: number, out: File[]): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name

  if (entry.isFile) {
    const file = await fileOf(entry)
    if (file) out.push(withPath(file, path))
    return
  }

  if (!entry.isDirectory || depth >= MAX_DEPTH) return
  for (const child of await readAll(entry)) {
    await collect(child, path, depth + 1, out)
  }
}

function fileOf(entry: Entry): Promise<File | null> {
  if (!entry.file) return Promise.resolve(null)
  return new Promise((resolve) => {
    // A file that has been deleted between the drag and the drop rejects here.
    // One unreadable file is not a reason to lose the other four hundred.
    entry.file!(resolve, () => resolve(null))
  })
}

function readAll(entry: Entry): Promise<Entry[]> {
  const reader = entry.createReader?.()
  if (!reader) return Promise.resolve([])

  return new Promise((resolve) => {
    const all: Entry[] = []
    const next = () =>
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(all)
            return
          }
          all.push(...batch)
          next()
        },
        () => resolve(all),
      )
    next()
  })
}

/**
 * `stageFiles` reads `webkitRelativePath` to label a row with where in the
 * folder it came from, and a file from the entries API has none — so the path
 * the walk already knows is written onto it, exactly as the folder picker does.
 */
function withPath(file: File, path: string): File {
  try {
    Object.defineProperty(file, "webkitRelativePath", { value: path, configurable: true })
  } catch {
    // Frozen somehow. The row falls back to the plain name, which is still true.
  }
  return file
}
