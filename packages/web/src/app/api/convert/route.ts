import { route } from "@/server/handler"
import { requireMatchingUser } from "@/server/session"
import { convert } from "@/server/services/convert"
import { requestId as validateRequestId, userId as validateUserId } from "@/server/validate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** §0.6 — the one gate. The server re-checks it rather than trusting a button. */
export const POST = route("convert", async (body, traceId) => {
  const claimed = validateUserId(body)
  const userId = await requireMatchingUser(claimed)
  const requestId = validateRequestId(body)

  return convert(userId, requestId, traceId)
})
