/**
 * A file that has landed in the bucket, remembered across a reload.
 *
 * The browser cannot keep a File handle across a navigation, so a refresh
 * mid-upload loses the bytes. It does not have to lose the *fact* of the upload:
 * once a file is confirmed, schema detection is already running on the server,
 * and all this screen needs to keep showing it is its id, its name, and the
 * signed url it was written to.
 */
export type RememberedFile = {
  fileId: string
  fileName: string
  fileLocation: string
  size: number
  /** The signed PUT url. Kept so a later action does not need a fresh one while it lasts. */
  filePath: string
  expiresAt: string
}

const keyFor = (requestId: string) => `quarry.batch.${requestId}.files`

/**
 * Files the server has answered for with a reason rather than a shape.
 *
 * Kept apart from the list above because the two are read by different halves
 * of the batch. Before the gate the file list is what the screen renders and
 * these are named in the panel of files that will not convert; after it, the
 * result poll returns nothing at all for a file with no shape — there is no
 * table for it to report — so the results screen needs to know the difference
 * between a file it is still waiting on and one that was never coming.
 */
const unreadableKeyFor = (requestId: string) => `quarry.batch.${requestId}.unreadable`

/**
 * Only files that can actually be rendered after a reload are kept: one without
 * a fileId cannot be matched to anything the schema poll returns, so it would
 * sit on screen as a row nothing ever updates.
 */
const showable = (file: RememberedFile) =>
  Boolean(file) && typeof file.fileId === "string" && file.fileId.length > 0

export function readRememberedFiles(requestId: string): RememberedFile[] {
  try {
    const raw = localStorage.getItem(keyFor(requestId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const kept = (parsed as RememberedFile[]).filter(showable)
    // Nothing left that can be shown — drop the map rather than leave a husk.
    if (kept.length === 0) forgetFiles(requestId)
    return kept
  } catch {
    return []
  }
}

/** Merged by fileId, so confirming a second batch of files does not drop the first. */
export function rememberFiles(requestId: string, files: RememberedFile[]) {
  const kept = files.filter(showable)
  if (kept.length === 0) return
  try {
    const existing = readRememberedFiles(requestId)
    const byId = new Map(existing.map((file) => [file.fileId, file]))
    for (const file of kept) byId.set(file.fileId, file)
    localStorage.setItem(keyFor(requestId), JSON.stringify([...byId.values()]))
  } catch {
    // Losing the map costs a file list after a refresh, not the upload itself.
  }
}

/** Ids the schema poll has reported a file-level failure for. Merged, never replaced. */
export function rememberUnreadable(requestId: string, fileIds: string[]) {
  if (fileIds.length === 0) return
  try {
    const kept = new Set([...readUnreadable(requestId), ...fileIds])
    localStorage.setItem(unreadableKeyFor(requestId), JSON.stringify([...kept]))
  } catch {
    // Losing the set costs a row that reads Detecting for the rest of a run.
  }
}

export function readUnreadable(requestId: string): string[] {
  try {
    const raw = localStorage.getItem(unreadableKeyFor(requestId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === "string")
  } catch {
    return []
  }
}

export function forgetFiles(requestId: string) {
  try {
    localStorage.removeItem(keyFor(requestId))
    localStorage.removeItem(unreadableKeyFor(requestId))
  } catch {
    // Nothing to do; the map is a convenience.
  }
}
