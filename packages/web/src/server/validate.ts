import "server-only"

import { ApiFailure } from "./failures"

/**
 * Request validation, hand-written.
 *
 * Seven endpoints with small, fixed bodies do not earn a schema library, and
 * every rejection here has to carry a failure class anyway — which is a thing
 * a generic validator would not know how to produce.
 */

/** Matches the CHECK constraint on users.id. Keep the two in step. */
const USER_ID = /^[A-Za-z0-9_-]{22,64}$/
/** Matches the CHECK constraint on requests.id. */
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/
/** `sch_` plus the worker's hex, but kept general so the id format can change. */
const SCHEMA_ID = /^[A-Za-z0-9_-]{8,64}$/

export function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiFailure("internal", { message: "Expected a JSON object." })
  }
  return value as Record<string, unknown>
}

export function str(
  body: Record<string, unknown>,
  key: string,
  options: { max?: number; pattern?: RegExp; label?: string } = {},
): string {
  const value = body[key]
  const label = options.label ?? key
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiFailure("internal", { message: `${label} is required.` })
  }
  const trimmed = value.trim()
  if (options.max && trimmed.length > options.max) {
    throw new ApiFailure("internal", { message: `${label} is too long.` })
  }
  if (options.pattern && !options.pattern.test(trimmed)) {
    throw new ApiFailure("internal", { message: `${label} is not in the expected form.` })
  }
  return trimmed
}

export function userId(body: Record<string, unknown>): string {
  // The entropy rule is enforced here and in the database, not assumed of the
  // client: the id is a bearer capability, and whoever holds it holds the
  // workspace.
  return str(body, "userId", { pattern: USER_ID, label: "userId" })
}

export function requestId(body: Record<string, unknown>): string {
  return str(body, "requestId", { pattern: REQUEST_ID, label: "requestId" })
}

export function schemaId(body: Record<string, unknown>): string {
  // Server-generated, unlike the user and request ids, so this is a shape
  // check rather than a defence — the row it names is still scoped by owner.
  return str(body, "schemaId", { pattern: SCHEMA_ID, label: "schemaId" })
}

export function array<T>(
  body: Record<string, unknown>,
  key: string,
  options: { max?: number; min?: number } = {},
): T[] {
  const value = body[key]
  if (!Array.isArray(value)) {
    throw new ApiFailure("internal", { message: `${key} must be an array.` })
  }
  if (options.min !== undefined && value.length < options.min) {
    throw new ApiFailure("internal", { message: `${key} cannot be empty.` })
  }
  if (options.max !== undefined && value.length > options.max) {
    throw new ApiFailure("internal", {
      message: `That is more than ${options.max} files in one go.`,
    })
  }
  return value as T[]
}

/**
 * A filename from the client, made safe to put in an object key.
 *
 * The key is server-generated (§17) and already carries a unique id prefix, so
 * this only has to stop path traversal and control characters from reaching
 * storage — not guarantee uniqueness.
 */
export function safeFilename(raw: string): string {
  // Both separators: a Windows client can send either.
  const base = raw.split(/[\\/]/).pop() ?? raw
  const cleaned = base
    // Leading dots would make a hidden file, and ".." a traversal attempt.
    .replace(/^\.+/, "")
    // An allowlist, so control characters and everything else exotic are gone
    // without needing to enumerate them.
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .trim()
  return (cleaned || "file").slice(0, 100)
}

/** Content type guessed from the extension. The bytes are checked later. */
const BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  rtf: "application/rtf",
  odt: "application/vnd.oasis.opendocument.text",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  txt: "text/plain",
  md: "text/markdown",
  png: "image/png",
  bmp: "image/bmp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
  heic: "image/heic",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  zip: "application/zip",
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".")
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase()
}

export function contentTypeFor(filename: string): string {
  return BY_EXTENSION[extensionOf(filename)] ?? "application/octet-stream"
}
