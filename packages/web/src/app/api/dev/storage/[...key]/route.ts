import { env } from "@/server/env"
import { writeLocalObject } from "@/server/storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Local development only — stands in for the bucket.
 *
 * `docker compose up` has no GCS, so `signUpload` hands the browser a URL
 * pointing back here and this route writes the bytes to disk. Same two-step
 * flow, same headers, same confirm call: the only thing that changes is where
 * the bytes land.
 *
 * It refuses to do anything unless STORAGE_BACKEND=local, so it cannot become
 * an unauthenticated write endpoint in a deployed environment by accident.
 */
function guard(): Response | null {
  if (env().storageBackend !== "local") {
    return Response.json({ error: "not_found" }, { status: 404 })
  }
  return null
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const blocked = guard()
  if (blocked) return blocked

  const { key } = await params
  const objectKey = key.join("/")

  const body = Buffer.from(await request.arrayBuffer())
  await writeLocalObject(objectKey, body)

  // GCS answers an empty 200, and the client must not learn to expect a body.
  return new Response(null, { status: 200 })
}

/** The browser preflights a cross-origin PUT; same-origin here, but harmless. */
export async function OPTIONS(): Promise<Response> {
  const blocked = guard()
  if (blocked) return blocked

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  })
}
