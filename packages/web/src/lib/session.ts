import { api } from "@/lib/api"

const KEY = "quarry.userId"
const REGISTERED = "quarry.registered"

/** 128 bits, base64url. The id is a bearer capability, so its entropy is the security control. */
function newUserId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const b64 = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
  return `usr_${b64}`
}

export function getUserId(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export async function ensureSession(adopt?: string | null): Promise<string> {
  const existing = getUserId()
  const id = adopt ?? existing ?? newUserId()

  if (id !== existing) {
    localStorage.setItem(KEY, id)
    localStorage.removeItem(REGISTERED)
  }
  if (localStorage.getItem(REGISTERED) === id) return id

  await api.register(id)
  localStorage.setItem(REGISTERED, id)
  return id
}

export function workspaceLink(userId: string, origin: string): string {
  return `${origin}/?w=${userId}`
}

/** A request id is client-generated, which is what makes getSignedUrl idempotent. */
export function newRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  const b64 = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
  return `req_${b64}`
}
