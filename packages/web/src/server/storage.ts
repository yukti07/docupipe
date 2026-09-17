import "server-only"

import type { StorageOptions } from "@google-cloud/storage"

import { env } from "./env"
import { gcpAuthClient } from "./gcp-auth"

/**
 * Signed upload URLs and object verification.
 *
 * Two backends behind one interface, so `docker compose` runs the whole flow
 * with no cloud account:
 *
 *   gcs    — a V4 signed PUT URL
 *   local  — a URL pointing at this app's own dev upload route
 */

export type ObjectInfo = {
  exists: boolean
  size: number
  generation: string | null
  checksum: string | null
}

export type SignedUpload = {
  url: string
  headers: Record<string, string>
  expiresAt: string
}

/** requests/<requestId>/input/<fileId>-<safe name> — one prefix per request. */
export function inputKey(requestId: string, fileId: string, safeName: string): string {
  return `requests/${requestId}/input/${fileId}-${safeName}`
}

export function outputKey(requestId: string, fileId: string): string {
  return `requests/${requestId}/output/${fileId}/result.txt`
}

/* ------------------------------------------------------------------- gcs */

async function bucket() {
  // Lazy. A Storage client constructed at module scope resolves credentials
  // during `next build`, where there is no OIDC token — and the error it
  // raises names credentials rather than timing.
  const { Storage } = await import("@google-cloud/storage")
  const cfg = env()
  if (!cfg.bucket) throw new Error("GCS_BUCKET_NAME is required when STORAGE_BACKEND=gcs")
  // `undefined` leaves the client on ADC, which is what local development
  // uses. Deployed, it is the federated credential (`gcp-auth.ts`).
  //
  // The cast is version skew, not a silenced error: this package resolves
  // google-auth-library v11 while @google-cloud/storage still pins v9, whose
  // AuthClient type declares a member v11 dropped. Storage only ever calls
  // getCredentials / request / sign on it, and v11 has all three.
  const authClient = (await gcpAuthClient()) as unknown as StorageOptions["authClient"]
  return new Storage({ authClient }).bucket(cfg.bucket)
}

async function gcsSignedUpload(key: string, contentType: string): Promise<SignedUpload> {
  const cfg = env()
  const expires = Date.now() + cfg.signedUrlTtlMs

  // There is no private key anywhere: signing falls back to the IAM Credentials
  // signBlob API, which needs the credential to carry a client_email. That only
  // exists when the external-account credential uses service account
  // IMPERSONATION — direct resource access fails here with
  // "Cannot sign data without `client_email`".
  const [url] = await (await bucket()).file(key).getSignedUrl({
    version: "v4",
    action: "write",
    expires,
    contentType,
  })

  return {
    url,
    // The browser must send this back byte-for-byte. A different Content-Type
    // is a different request, GCS answers 403, and because that response has no
    // CORS headers the browser reports it as a CORS error.
    headers: { "Content-Type": contentType },
    expiresAt: new Date(expires).toISOString(),
  }
}

async function gcsStat(key: string): Promise<ObjectInfo> {
  const [exists] = await (await bucket()).file(key).exists()
  if (!exists) return { exists: false, size: 0, generation: null, checksum: null }

  const [metadata] = await (await bucket()).file(key).getMetadata()
  return {
    exists: true,
    size: Number(metadata.size ?? 0),
    generation: metadata.generation != null ? String(metadata.generation) : null,
    checksum: metadata.md5Hash ?? null,
  }
}

/* ----------------------------------------------------------------- local */

function localRoot(): string {
  return env().localStorageRoot
}

async function localPath(key: string) {
  const path = await import("node:path")
  const root = path.resolve(localRoot())
  const resolved = path.resolve(root, key)
  // The key is server-generated, but refuse traversal anyway: this is the one
  // place a bad key becomes a write outside the root.
  if (!resolved.startsWith(root)) throw new Error(`unsafe object key: ${key}`)
  return { path, root, resolved }
}

async function localStat(key: string): Promise<ObjectInfo> {
  const fs = await import("node:fs/promises")
  const crypto = await import("node:crypto")
  const { resolved } = await localPath(key)
  try {
    const data = await fs.readFile(resolved)
    return {
      exists: true,
      size: data.byteLength,
      generation: null,
      checksum: crypto.createHash("md5").update(data).digest("base64"),
    }
  } catch {
    return { exists: false, size: 0, generation: null, checksum: null }
  }
}

export async function writeLocalObject(key: string, data: Buffer): Promise<void> {
  const fs = await import("node:fs/promises")
  const { path, resolved } = await localPath(key)
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await fs.writeFile(resolved, data)
}

/* --------------------------------------------------------------- exports */

export async function signUpload(key: string, contentType: string): Promise<SignedUpload> {
  const cfg = env()
  if (cfg.storageBackend === "local") {
    return {
      // Points back at this app. The dev route refuses to exist in production.
      url: `/api/dev/storage/${key}`,
      headers: { "Content-Type": contentType },
      expiresAt: new Date(Date.now() + cfg.signedUrlTtlMs).toISOString(),
    }
  }
  return gcsSignedUpload(key, contentType)
}

export async function statObject(key: string): Promise<ObjectInfo> {
  return env().storageBackend === "local" ? localStat(key) : gcsStat(key)
}

export function bucketName(): string {
  const cfg = env()
  return cfg.storageBackend === "local" ? "local" : cfg.bucket
}
