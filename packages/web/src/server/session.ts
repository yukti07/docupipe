import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"

import { env } from "./env"
import { Unauthenticated } from "./failures"

/**
 * The session is a signed, httpOnly cookie holding the user id.
 *
 * A signed cookie is enough and a JWT is not needed: one service issues it and
 * the same service reads it. There is no third party to convince.
 */

export const COOKIE_NAME = "sid"
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60

function sign(userId: string): string {
  const mac = createHmac("sha256", env().sessionSecret).update(userId).digest("base64url")
  return `${userId}.${mac}`
}

function verify(value: string): string | null {
  const dot = value.lastIndexOf(".")
  if (dot <= 0) return null

  const userId = value.slice(0, dot)
  const provided = value.slice(dot + 1)
  const expected = createHmac("sha256", env().sessionSecret)
    .update(userId)
    .digest("base64url")

  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false.
  if (a.length !== b.length) return null
  return timingSafeEqual(a, b) ? userId : null
}

export async function setSessionCookie(userId: string): Promise<void> {
  const store = await cookies()
  store.set(COOKIE_NAME, sign(userId), {
    httpOnly: true, // browser JavaScript can never read it
    secure: env().isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  })
}

/**
 * Who is calling.
 *
 * Order matters, and rule 2 is local-development only. `ALLOW_DEV_USER` is
 * refused in production by `env()`, which is where that check belongs — a flag
 * that disables authorization must fail at startup, not at request time.
 */
export async function currentUserId(): Promise<string | null> {
  const store = await cookies()
  const raw = store.get(COOKIE_NAME)?.value
  if (raw) {
    const verified = verify(raw)
    if (verified) return verified
  }

  const { allowDevUser, devUserId } = env()
  if (allowDevUser && devUserId) return devUserId

  return null
}

export async function requireUserId(): Promise<string> {
  const userId = await currentUserId()
  if (!userId) throw new Unauthenticated()
  return userId
}

/**
 * The body's `requestorId` is a CLAIM. The cookie is the authority.
 *
 * Without this check every "verify this belongs to the user" downstream
 * verifies a value the caller chose, and changing one field reads somebody
 * else's files.
 */
export async function requireMatchingUser(claimed: string): Promise<string> {
  const actual = await requireUserId()
  if (claimed !== actual) {
    // Deliberately the same shape as any other denial: saying "that is not
    // your id" tells a caller which ids exist.
    throw new Unauthenticated()
  }
  return actual
}
