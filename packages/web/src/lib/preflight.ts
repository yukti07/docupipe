import type { Failure } from "@/lib/api/types"

/**
 * §0.2 puts pre-flight on the client, because getSignedUrl carries names only.
 * The server's real check is still the inspect worker's magic-byte sniff — this
 * is here so a file that can never work is refused in the drop zone rather than
 * after a 200 MB transfer.
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export const ACCEPTED_EXTENSIONS = [
  // documents
  "pdf", "docx", "doc", "rtf", "odt",
  // spreadsheets and records
  "xlsx", "xls", "csv", "tsv", "json",
  // plain text
  "txt", "md",
  // images, including scans
  "png", "jpg", "jpeg", "tif", "tiff", "webp", "heic",
  // audio
  "m4a", "mp3", "wav", "ogg", "flac",
] as const

/** What the drop zone writes inside itself, before anyone has tried anything. */
export const ACCEPTED_SUMMARY = "PDF, Word, Excel, CSV, JSON, text, images and audio"
export const SIZE_CAP_SUMMARY = "Up to 50 MB a file"

/** The extensions an <input type="file"> should advertise. */
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(",")

export type StagedFile = {
  /** Stable for the life of the drop, so a row keeps its identity through a retry. */
  localId: string
  file: File
  name: string
  /** webkitRelativePath for a folder drop, the plain name otherwise. */
  location: string
  size: number
  rejection?: Failure
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

/**
 * One file at a time, because one bad file never rejects the drop. Every file
 * comes back — the rejected ones carry their reason and stay on screen.
 */
export function preflight(file: File): Failure | undefined {
  const ext = extensionOf(file.name)

  if (ext === "zip" || ext === "rar" || ext === "7z" || ext === "tar" || ext === "gz") {
    return {
      class: "archive_not_expanded",
      message: `${file.name} — unzip it first.`,
      nextStep: "Unzip it and drop the files it holds.",
    }
  }

  if (file.size === 0) {
    return {
      class: "empty_file",
      message: "This file is empty.",
      nextStep: "Remove it; the rest carry on.",
    }
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      class: "too_large",
      message: `This file is ${Math.round(file.size / 1024 / 1024)} MB. The limit is 50 MB.`,
      nextStep: "Split it into smaller files and drop them.",
    }
  }

  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
    return {
      class: "format_unsupported",
      message: ext ? `.${ext} isn't supported.` : "That file has no readable format.",
      nextStep: `Supported types are ${ACCEPTED_SUMMARY}.`,
    }
  }

  return undefined
}

let counter = 0

export function stageFiles(files: File[]): StagedFile[] {
  return files.map((file) => {
    counter += 1
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath
    return {
      localId: `stg_${Date.now().toString(36)}_${counter}`,
      file,
      name: file.name,
      location: relative && relative.length > 0 ? relative : file.name,
      size: file.size,
      rejection: preflight(file),
    }
  })
}

export const acceptedFiles = (staged: StagedFile[]) => staged.filter((s) => !s.rejection)
export const rejectedFiles = (staged: StagedFile[]) => staged.filter((s) => s.rejection)
