import { transaction } from "@/server/db/client"
import * as repo from "@/server/db/repos"
import { env } from "@/server/env"
import { route } from "@/server/handler"
import { setSessionCookie } from "@/server/session"
import { userId as validateUserId } from "@/server/validate"

// pg and the GCP clients need Node, not the edge runtime.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * §0.1 — the client generates its own id and registers it.
 *
 * Registering an id that already exists SUCCEEDS. That is not a bug, it is the
 * "open this workspace in another browser" affordance — which also means the
 * id is a bearer capability, and its entropy is the whole security control.
 * The format is checked here and again by a CHECK constraint on the table.
 */
export const POST = route("register", async (body) => {
  const id = validateUserId(body)

  await transaction(async (tx) => {
    await repo.upsertUser(tx, id)
    await repo.ensureAllowance(tx, id, env().defaultDailyLimit)
  })

  // The cookie is what every later call reads. The body's `requestorId` is
  // only ever a claim checked against it.
  await setSessionCookie(id)

  return { status: "ok" }
})
