import "server-only"

import { transaction } from "../db/client"
import * as repo from "../db/repos"
import { fail } from "../handler"

export type DiscardResponse = {
  status: "ok"
  discarded: number
  /** Files still live in this request, so the screen knows when nothing is left. */
  remaining: number
}

/**
 * Take files out of a request.
 *
 * A soft delete rather than a row removal: `deleted_at` is the boundary every
 * other read in this codebase already respects — `listFiles`, the schema poll's
 * file query and `getTable` all carry `deleted_at IS NULL` — so setting it is
 * the whole of the change. The schemas, results and events stay, which is what
 * makes the discard answerable afterwards.
 *
 * Ownership is in the WHERE clause, and the count of updated rows is what is
 * reported: a caller who names files that are not theirs is told nothing was
 * discarded rather than which ids exist.
 */
export async function discardFiles(
  userId: string,
  requestId: string,
  fileIds: string[],
  traceId?: string,
): Promise<DiscardResponse> {
  const request = await repo.getRequest(requestId, userId)
  if (!request) throw fail("internal", "We don't have a record of that request.")

  return transaction(async (tx) => {
    const updated = await tx.query<{ id: string; original_filename: string }>(
      `UPDATE files
          SET deleted_at = now(), updated_at = now()
        WHERE id = ANY($1::text[])
          AND request_id = $2
          AND user_id = $3
          AND deleted_at IS NULL
      RETURNING id, original_filename`,
      [fileIds, requestId, userId],
    )

    for (const file of updated.rows) {
      await repo.recordEvent(tx, {
        requestId,
        userId,
        fileId: file.id,
        type: "FILE_DISCARDED",
        message: `${file.original_filename} was discarded by the user.`,
        traceId,
      })
    }

    const live = await tx.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM files
        WHERE request_id = $1 AND deleted_at IS NULL`,
      [requestId],
    )

    return {
      status: "ok" as const,
      discarded: updated.rowCount ?? 0,
      remaining: Number(live.rows[0]?.count ?? 0),
    }
  })
}
