import { route } from "@/server/handler"
import { requireUserId } from "@/server/session"
import { getMergeOverview } from "@/server/services/merges"
import { requestId as validateRequestId } from "@/server/validate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * The finished tables that can still be combined, grouped by shape, plus the
 * merges already made. Like /api/table it takes no `userId`: the cookie is the
 * only claim, which is the stronger of the two arrangements.
 */
export const POST = route("merge/groups", async (body) => {
  const userId = await requireUserId()
  const requestId = validateRequestId(body)

  return getMergeOverview(userId, requestId)
})
