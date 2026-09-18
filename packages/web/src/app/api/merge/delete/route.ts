import { route } from "@/server/handler"
import { requireMatchingUser } from "@/server/session"
import { deleteMerge } from "@/server/services/merges"
import {
  mergeId as validateMergeId,
  requestId as validateRequestId,
  userId as validateUserId,
} from "@/server/validate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Splits a merged table back into the tables it was made from. Moves no rows. */
export const POST = route("merge/delete", async (body, traceId) => {
  const claimed = validateUserId(body)
  const userId = await requireMatchingUser(claimed)
  const requestId = validateRequestId(body)
  const mergeId = validateMergeId(body)

  return deleteMerge(userId, requestId, mergeId, traceId)
})
