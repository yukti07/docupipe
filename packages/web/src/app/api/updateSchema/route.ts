import type { SchemaSaveEntry } from "@/lib/api/types"
import { route } from "@/server/handler"
import { requireMatchingUser } from "@/server/session"
import { updateSchemas } from "@/server/services/schemas"
import { array, requestId as validateRequestId, userId as validateUserId } from "@/server/validate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * §0.5 — save an edit against every (fileId, schemaId) it covers.
 *
 * Apply-to-all is expressed as several entries in one call: the scope IS the
 * list, so the server never reconstructs what the user meant. It does validate
 * that every entry genuinely shares the edited schema's original shape, and
 * rejects the whole call if one does not — never a partial apply.
 */
export const POST = route("updateSchema", async (body) => {
  const claimed = validateUserId(body)
  const userId = await requireMatchingUser(claimed)
  const requestId = validateRequestId(body)
  const files = array<SchemaSaveEntry>(body, "files", { min: 1 })

  return updateSchemas(userId, requestId, files)
})
