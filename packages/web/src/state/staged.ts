import type { StagedFile } from "@/lib/preflight"

/**
 * A drop happens on the workspace and the upload happens on the batch screen,
 * and File objects cannot travel through a URL. They are parked here for the
 * one navigation in between.
 *
 * Deliberately not persisted: a reload loses the handles, and the batch screen
 * then reads the truth from the schema poll rather than pretending to resume an
 * upload it no longer holds the bytes for.
 */
const staged = new Map<string, StagedFile[]>()

export function stageForRequest(requestId: string, files: StagedFile[]) {
  staged.set(requestId, files)
}

export function takeStagedFiles(requestId: string): StagedFile[] | null {
  const files = staged.get(requestId)
  if (!files) return null
  staged.delete(requestId)
  return files
}

export function peekStagedFiles(requestId: string): StagedFile[] | null {
  return staged.get(requestId) ?? null
}
