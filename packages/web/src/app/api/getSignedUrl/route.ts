import { route } from "@/server/handler"
import { requireMatchingUser } from "@/server/session"
import { createUploadUrls } from "@/server/services/uploads"
import { array, requestId as validateRequestId, userId as validateUserId } from "@/server/validate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** §0.2 — one call for the whole drop, one signed PUT url per file. */
export const POST = route("getSignedUrl", async (body, traceId) => {
  const claimed = validateUserId(body)
  const userId = await requireMatchingUser(claimed)
  const requestId = validateRequestId(body)
  const files = array<string>(body, "files", { min: 1 })

  return createUploadUrls(userId, requestId, files, traceId)
})
