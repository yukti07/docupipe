import { route } from "@/server/handler"
import { requireMatchingUser } from "@/server/session"
import { pollSchemas } from "@/server/services/schemas"
import { requestId as validateRequestId, userId as validateUserId } from "@/server/validate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** §0.4 — a delta poll: only files the client does not already hold. */
export const POST = route("polling/schema", async (body) => {
  const claimed = validateUserId(body)
  const userId = await requireMatchingUser(claimed)
  const requestId = validateRequestId(body)

  const received = Array.isArray(body.received) ? (body.received as unknown[]).map(String) : []

  return pollSchemas(userId, requestId, received)
})
