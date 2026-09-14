import type { UploadedFile } from "@/lib/api/types"
import { route } from "@/server/handler"
import { requireMatchingUser } from "@/server/session"
import { confirmUploads } from "@/server/services/uploads"
import { array, requestId as validateRequestId, userId as validateUserId } from "@/server/validate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * §0.3 — the browser's PUTs have landed.
 *
 * Idempotent per fileId, so batched or one at a time are both fine.
 */
export const POST = route("upload", async (body, traceId) => {
  const claimed = validateUserId(body)
  const userId = await requireMatchingUser(claimed)
  const requestId = validateRequestId(body)
  const files = array<UploadedFile>(body, "files", { min: 1 })

  return confirmUploads(userId, requestId, files, traceId)
})
