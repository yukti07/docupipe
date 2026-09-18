import { route } from "@/server/handler"
import { requireMatchingUser } from "@/server/session"
import { discardFiles } from "@/server/services/discard"
import {
  fileIds as validateFileIds,
  requestId as validateRequestId,
  userId as validateUserId,
} from "@/server/validate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Takes files out of a request for good — the way out of a file that won't convert. */
export const POST = route("discard", async (body, traceId) => {
  const claimed = validateUserId(body)
  const userId = await requireMatchingUser(claimed)
  const requestId = validateRequestId(body)
  const fileIds = validateFileIds(body)

  return discardFiles(userId, requestId, fileIds, traceId)
})
