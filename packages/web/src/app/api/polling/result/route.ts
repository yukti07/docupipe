import { route } from "@/server/handler"
import { requireMatchingUser } from "@/server/session"
import { pollResult } from "@/server/services/convert"
import { requestId as validateRequestId, userId as validateUserId } from "@/server/validate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** §0.7 — a snapshot, not a delta. Every table on every poll. */
export const POST = route("polling/result", async (body) => {
  const claimed = validateUserId(body)
  const userId = await requireMatchingUser(claimed)
  const requestId = validateRequestId(body)

  return pollResult(userId, requestId)
})
