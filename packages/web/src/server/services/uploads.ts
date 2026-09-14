import "server-only"

import type {
  SignedUrlFile,
  SignedUrlResponse,
  UploadResponse,
  UploadedFile,
} from "@/lib/api/types"
import { transaction } from "../db/client"
import * as repo from "../db/repos"
import { env } from "../env"
import { newId } from "../handler"
import { publishAll, type Message } from "../publish"
import { bucketName, inputKey, signUpload, statObject } from "../storage"
import { array, contentTypeFor, safeFilename } from "../validate"

const EVENT = {
  REQUEST_CREATED: "REQUEST_CREATED",
  UPLOAD_INITIALIZED: "UPLOAD_INITIALIZED",
  UPLOAD_CONFIRMED: "UPLOAD_CONFIRMED",
  FILE_FAILED: "FILE_FAILED",
}

/**
 * §0.2 — create the request and hand back one signed URL per file.
 *
 * STRICTLY ONE ENTRY PER NAME, IN THE ORDER ASKED. The client matches
 * positionally (`accepted.forEach((file, index) => signedFiles[index])`), so
 * filtering or reordering here silently pairs a file with someone else's URL.
 *
 * Nothing is rejected on format. The contract puts pre-flight on the client —
 * this call carries names only, with no size and no declared type — and the
 * real check is the inspect worker sniffing magic bytes, which is the only
 * thing that can tell a `.pdf` that is really a ZIP from one that isn't.
 *
 * Idempotent on `requestId`: the same id twice returns the same request and
 * the same fileIds rather than creating a second request, so a retried call on
 * a flaky connection is harmless.
 */
export async function createUploadUrls(
  userId: string,
  requestId: string,
  fileNames: string[],
  traceId: string,
): Promise<SignedUrlResponse> {
  const cfg = env()
  const names = array<string>({ files: fileNames }, "files", {
    min: 1,
    max: cfg.maxFilesPerRequest,
  }).map((n) => String(n).trim())

  if (names.some((n) => n === "")) {
    throw new Error("A file name cannot be empty.")
  }

  const existing = await repo.getRequest(requestId, userId)

  // Seen this requestId before: hand back the same rows, in the same order, so
  // a retry pairs each name with the file it already created.
  if (existing) {
    const files = await repo.listFiles(requestId)
    const byName = new Map<string, repo.FileRow[]>()
    for (const file of files) {
      const list = byName.get(file.original_filename) ?? []
      list.push(file)
      byName.set(file.original_filename, list)
    }

    const replayed = await Promise.all(
      names.map(async (name) => {
        const candidate = byName.get(name)?.shift()
        if (!candidate) {
          // A name that was not in the original call. Give it a row now rather
          // than returning a gap the client would misalign on.
          return createOne(requestId, userId, name, traceId)
        }
        return toSignedFile(candidate.id, name, candidate.object_key ?? "")
      }),
    )
    return { userId, requestId, files: replayed }
  }

  const planned = names.map((name) => ({
    id: newId("file"),
    name,
    key: "",
  }))
  for (const file of planned) {
    file.key = inputKey(requestId, file.id, safeFilename(file.name))
  }

  await transaction(async (tx) => {
    await repo.createRequestIfAbsent(tx, requestId, userId)
    await repo.recordEvent(tx, {
      requestId,
      userId,
      type: EVENT.REQUEST_CREATED,
      metadata: { files: planned.length },
      traceId,
    })

    for (const file of planned) {
      await repo.insertFile(tx, {
        id: file.id,
        requestId,
        userId,
        filename: file.name,
        contentType: contentTypeFor(file.name),
        bucket: bucketName(),
        objectKey: file.key,
        fileLocation: null,
      })
    }

    await repo.recordEvent(tx, {
      requestId,
      userId,
      type: EVENT.UPLOAD_INITIALIZED,
      metadata: { files: planned.length },
      traceId,
    })
    await repo.refreshRequestStatus(tx, requestId)
  })

  const files = await Promise.all(
    planned.map((f) => toSignedFile(f.id, f.name, f.key)),
  )
  return { userId, requestId, files }
}

/** Adds one file to an existing request, for the replay path above. */
async function createOne(
  requestId: string,
  userId: string,
  name: string,
  traceId: string,
): Promise<SignedUrlFile> {
  const id = newId("file")
  const key = inputKey(requestId, id, safeFilename(name))

  await transaction(async (tx) => {
    await repo.insertFile(tx, {
      id,
      requestId,
      userId,
      filename: name,
      contentType: contentTypeFor(name),
      bucket: bucketName(),
      objectKey: key,
      fileLocation: null,
    })
    await repo.recordEvent(tx, {
      requestId, userId, fileId: id, type: EVENT.UPLOAD_INITIALIZED, traceId,
    })
    await repo.refreshRequestStatus(tx, requestId)
  })

  return toSignedFile(id, name, key)
}

async function toSignedFile(
  fileId: string,
  fileName: string,
  key: string,
): Promise<SignedUrlFile> {
  const upload = await signUpload(key, contentTypeFor(fileName))
  return {
    fileId,
    fileName,
    // `filePath` IS the signed PUT url, not an object key.
    filePath: upload.url,
    // Must be sent back byte-for-byte. A different Content-Type is a different
    // request, GCS answers 403, and the browser reports it as a CORS error.
    uploadHeaders: upload.headers,
    expiresAt: upload.expiresAt,
  }
}

/**
 * §0.3 — confirm the browser's PUTs landed.
 *
 * Never marks a file uploaded because `/api/getSignedUrl` returned
 * successfully: handing out a signed URL says nothing about whether anything
 * was written to it. Each file is checked against the object actually in the
 * bucket, and one that is missing settles as an `acquisition` failure on its
 * own row — not a 500, and not a silent success.
 *
 * Matched by fileId, so batched or one at a time are both fine, and a repeat
 * is a no-op.
 */
export async function confirmUploads(
  userId: string,
  requestId: string,
  files: UploadedFile[],
  traceId: string,
): Promise<UploadResponse> {
  const cfg = env()
  const results: UploadResponse["files"] = []
  const toPublish: { outboxId: number; message: Message }[] = []

  for (const entry of files) {
    const fileId = String(entry?.fileId ?? "")
    if (!fileId) continue
    const fileLocation = typeof entry?.fileLocation === "string" ? entry.fileLocation : null

    const outcome = await transaction(async (tx) => {
      const file = await repo.getFileForUser(tx, fileId, userId)

      // Not theirs, or not real. The same answer either way — saying which
      // would tell a caller which ids exist.
      if (!file || file.request_id !== requestId) return null

      if (fileLocation) await repo.setFileLocation(tx, fileId, fileLocation)

      // Already past UPLOADING: a duplicate confirm reports the state it is in
      // rather than treating it as an error.
      if (file.stage !== "UPLOADING") {
        return file.stage === "FAILED"
          ? { fileId, stage: "FAILED" as const, failureClass: file.failure_class, detail: file.failure_detail }
          : { fileId, stage: "UPLOADED" as const }
      }

      const info = await statObject(file.object_key ?? "")

      if (!info.exists) {
        return settleFailed(tx, { requestId, userId, fileId, traceId },
          "acquisition", "The upload never reached storage.")
      }
      if (info.size === 0) {
        return settleFailed(tx, { requestId, userId, fileId, traceId },
          "empty_file", "This file is empty.")
      }
      // The declared size was a claim; this is the real one.
      if (info.size > cfg.maxUploadBytes) {
        return settleFailed(tx, { requestId, userId, fileId, traceId },
          "too_large", "This file is past the size we can read in one go.")
      }

      await repo.markUploaded(tx, fileId, {
        generation: info.generation,
        checksum: info.checksum,
        sizeBytes: info.size,
      })
      await repo.recordEvent(tx, {
        requestId, userId, fileId, type: EVENT.UPLOAD_CONFIRMED,
        metadata: { bytes: info.size }, traceId,
      })

      // Same transaction as the stage change. If the publish below fails, this
      // row is still committed and the worker's sweep relays it — which is why
      // a broker blip never fails a request the user made.
      const outboxId = await repo.enqueue(tx, {
        requestId, fileId, topic: cfg.topicFileUploaded, payload: { fileId },
      })

      return { fileId, stage: "UPLOADED" as const, outboxId }
    })

    if (!outcome) {
      results.push({
        fileId,
        stage: "FAILED",
        failureClass: "acquisition",
        message: "We don't have a record of that file.",
        nextStep: "Upload it again.",
      })
      continue
    }

    if ("outboxId" in outcome && typeof outcome.outboxId === "number") {
      toPublish.push({
        outboxId: outcome.outboxId,
        message: {
          topic: cfg.topicFileUploaded,
          payload: { fileId },
          attributes: { requestTraceId: traceId, userId, requestId },
        },
      })
    }

    results.push({
      fileId: outcome.fileId,
      stage: outcome.stage,
      ...("failureClass" in outcome && outcome.failureClass
        ? { failureClass: outcome.failureClass, message: outcome.detail ?? undefined }
        : {}),
    })
  }

  await transaction((tx) => repo.refreshRequestStatus(tx, requestId))

  const delivered = await publishAll(toPublish)
  await repo.markOutboxPublished(delivered)

  return { status: "ok", files: results }
}

async function settleFailed(
  tx: Parameters<typeof repo.failFile>[0],
  ctx: { requestId: string; userId: string; fileId: string; traceId: string },
  failureClass: "acquisition" | "empty_file" | "too_large",
  detail: string,
) {
  await repo.failFile(tx, ctx.fileId, failureClass, detail)
  await repo.recordEvent(tx, {
    requestId: ctx.requestId,
    userId: ctx.userId,
    fileId: ctx.fileId,
    type: EVENT.FILE_FAILED,
    message: detail,
    metadata: { failureClass },
    traceId: ctx.traceId,
  })
  return { fileId: ctx.fileId, stage: "FAILED" as const, failureClass, detail }
}
