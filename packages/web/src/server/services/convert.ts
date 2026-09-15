import "server-only"

import type { ConvertResponse, ResultEntry, ResultPollResponse } from "@/lib/api/types"
import { transaction } from "../db/client"
import * as repo from "../db/repos"
import { env } from "../env"
import { fail } from "../handler"
import { publishAll } from "../publish"

/**
 * §0.6 — the gate, and §0.7 — the result poll.
 */

/**
 * The one gate in the product: every file has to have *arrived*.
 *
 * It is not a gate on schemas. Someone who does not want to review a shape
 * should not be made to wait for one, so Convert is accepted while files are
 * still being inspected: the ones whose shape is in start now, and each of the
 * rest is carried straight into conversion by the inspect worker the moment
 * its shape lands (see `_convert_if_already_requested` in the worker pipeline).
 *
 * The server re-checks the condition itself rather than trusting a greyed-out
 * button: a caller bypassing the UI gets the same answer.
 */
export async function convert(
  userId: string,
  requestId: string,
  traceId: string,
): Promise<ConvertResponse> {
  const outcome = await transaction(async (tx) => {
    const request = await repo.getRequest(requestId, userId)
    if (!request) throw fail("internal", "We don't have a record of that request.")

    const files = await repo.listFiles(requestId)
    if (files.length === 0) throw fail("gate_not_met", "No files have been uploaded yet.")

    // Idempotent: a second press while it is already running reports the same
    // counts rather than an error.
    if (request.converted_at !== null) {
      return {
        queued: files.filter((f) => f.stage === "CONVERTING" || f.stage === "COMPLETED").length,
        skipped: files.filter((f) => f.stage === "FAILED").length,
        outbox: [] as { id: number; fileId: string }[],
      }
    }

    const arriving = files.filter((f) => f.stage === "UPLOADING").length

    if (arriving > 0) {
      throw fail(
        "gate_not_met",
        arriving === 1
          ? "1 file is still uploading."
          : `${arriving} files are still uploading.`,
        { pending: arriving },
      )
    }

    const moved = await repo.startConverting(tx, requestId)

    await tx.query(
      `UPDATE requests SET status = 'CONVERTING', converted_at = now(), updated_at = now()
        WHERE id = $1`,
      [requestId],
    )

    // One outbox row per file, in the same transaction as the stage change.
    const outbox: { id: number; fileId: string }[] = []
    for (const fileId of moved) {
      const id = await repo.enqueue(tx, {
        requestId,
        fileId,
        topic: env().topicConvertRequested,
        payload: { fileId },
      })
      outbox.push({ id, fileId })
    }

    // Still being inspected when Convert was pressed. They are not skipped and
    // not blockers — the inspect worker hands each one on as its shape lands.
    const awaitingShape = files.filter(
      (f) => f.stage === "UPLOADED" || f.stage === "INSPECTING",
    ).length

    await repo.recordEvent(tx, {
      requestId,
      userId,
      type: "CONVERT_REQUESTED",
      metadata: { queued: moved.length, awaitingShape, skipped: failedCount(files) },
      traceId,
    })

    return {
      queued: moved.length,
      // Files already failed are carried through as failures, never blockers —
      // one unreadable file must not hold thirty-eight good ones hostage.
      skipped: failedCount(files),
      outbox,
    }
  })

  if (outcome.outbox.length > 0) {
    const delivered = await publishAll(
      outcome.outbox.map(({ id, fileId }) => ({
        outboxId: id,
        message: {
          topic: env().topicConvertRequested,
          payload: { fileId },
          attributes: { requestTraceId: traceId, userId, requestId },
        },
      })),
    )
    await repo.markOutboxPublished(delivered)
  }

  return { status: "received", queued: outcome.queued, skipped: outcome.skipped }
}

const failedCount = (files: { stage: string }[]) =>
  files.filter((f) => f.stage === "FAILED").length

/**
 * A snapshot, not a delta — every table is returned on every poll.
 *
 * The five counts must always sum to the number of TABLES in the request,
 * failures included: the processing screen renders them as the pipeline
 * itself, so a count that does not add up is visible immediately as a stage
 * that has lost a table.
 */
export async function pollResult(
  userId: string,
  requestId: string,
): Promise<ResultPollResponse> {
  const request = await repo.getRequest(requestId, userId)
  if (!request) throw fail("internal", "We don't have a record of that request.")

  const [files, schemas, results, allowance] = await Promise.all([
    repo.listFiles(requestId),
    repo.listSchemas(requestId),
    repo.listResults(requestId),
    repo.getAllowance(userId),
  ])

  const fileById = new Map(files.map((f) => [f.id, f]))
  const resultBySchema = new Map(results.map((r) => [r.file_schema_id, r]))

  const entries: ResultEntry[] = []
  const counts = { queued: 0, extracting: 0, filling: 0, done: 0, failed: 0 }
  let rowsSoFar = 0

  for (const schema of schemas) {
    const file = fileById.get(schema.file_id)
    if (!file) continue

    const result = resultBySchema.get(schema.id)

    // A file that failed before its tables were ever touched has no result
    // row. Its tables are still FAILED — otherwise the counts never reach the
    // table total and a stage looks like it lost one.
    const stage: ResultEntry["stage"] =
      file.stage === "FAILED" ? "FAILED" : (result?.stage ?? "QUEUED")

    switch (stage) {
      case "QUEUED": counts.queued += 1; break
      case "EXTRACTING": counts.extracting += 1; break
      case "FILLING": counts.filling += 1; break
      case "DONE": counts.done += 1; break
      case "FAILED": counts.failed += 1; break
    }

    rowsSoFar += result?.row_count ?? 0

    entries.push({
      fileId: file.id,
      fileName: file.original_filename,
      schemaId: schema.id,
      stage,
      rowCount: result?.row_count ?? 0,
      fieldCount: result?.field_count ?? schema.fields.length,
      toCheckCount: result?.to_check_count ?? 0,
      ...(result?.progress_unit && result.progress_at != null && result.progress_of != null
        ? {
            progress: {
              unit: result.progress_unit as "page" | "row",
              at: result.progress_at,
              of: result.progress_of,
            },
          }
        : {}),
      ...(stage === "FAILED"
        ? {
            failure: {
              class: result?.failure_class ?? file.failure_class ?? "internal",
              message: result?.failure_detail ?? file.failure_detail ?? undefined,
            },
          }
        : {}),
    })
  }

  return {
    userId,
    requestId,
    status: pollStatus(request.status),
    // PAUSED is not an error and must never be rendered as one. The time is
    // what makes it a pause rather than a stall.
    pausedUntil: request.paused_until ? request.paused_until.toISOString() : null,
    counts,
    rowsSoFar,
    // No estimator yet. `null` is the honest answer; a made-up number would be
    // worse than none.
    estimatedSecondsRemaining: null,
    allowance: {
      used: allowance?.used ?? 0,
      limit: allowance?.daily_limit ?? env().defaultDailyLimit,
      resetsAt: (allowance?.resets_at ?? endOfDay()).toISOString(),
    },
    files: entries,
  }
}

function pollStatus(status: repo.RequestStatus): ResultPollResponse["status"] {
  switch (status) {
    case "PAUSED": return "PAUSED"
    case "COMPLETED": return "COMPLETED"
    case "FAILED": return "FAILED"
    default: return "CONVERTING"
  }
}

function endOfDay(): Date {
  const next = new Date()
  next.setUTCHours(24, 0, 0, 0)
  return next
}
