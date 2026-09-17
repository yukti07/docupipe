import { route } from "@/server/handler"
import { requireUserId } from "@/server/session"
import { getTable } from "@/server/services/tables"
import { requestId as validateRequestId, schemaId as validateSchemaId } from "@/server/validate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * §0.9 — one table's rows.
 *
 * The seven routes take a `userId` in the body and check it against the cookie.
 * This one has no such field to check, because `getTable(requestId, schemaId)`
 * on the client never had one — so the cookie is the only claim, which is the
 * stronger of the two arrangements anyway.
 */
export const POST = route("table", async (body) => {
  const userId = await requireUserId()
  const requestId = validateRequestId(body)
  const schemaId = validateSchemaId(body)

  return getTable(userId, requestId, schemaId)
})
