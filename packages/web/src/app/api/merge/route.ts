import { route } from "@/server/handler"
import { requireMatchingUser } from "@/server/session"
import { createMerges } from "@/server/services/merges"
import {
  mergeSubmissions as validateMerges,
  requestId as validateRequestId,
  userId as validateUserId,
} from "@/server/validate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Several merges in one submit — four tables of one shape and two of another
 * is one press, and one transaction.
 *
 * A refusal comes back with a 200 and `ok: false`. The screen renders the
 * conflict beside the selection that caused it, and a thrown request would
 * leave it with nothing to render.
 */
export const POST = route("merge", async (body, traceId) => {
  const claimed = validateUserId(body)
  const userId = await requireMatchingUser(claimed)
  const requestId = validateRequestId(body)
  const merges = validateMerges(body)

  return createMerges(userId, requestId, merges, traceId)
})
