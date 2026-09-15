import { Storage } from "@google-cloud/storage"
import { failure } from "../report.mjs"

/**
 * The bucket, end to end: the signed URL, an actual PUT through it, the read
 * back, and the negative test.
 *
 * `curl` is not enough to prove uploads work — GCS answers the browser's
 * preflight from the bucket's CORS configuration, not from the signed URL, so
 * a bucket with no CORS fails every browser upload while curl succeeds. That
 * is checked here explicitly.
 */

export async function run(report, cfg, state) {
  report.group("Cloud Storage")

  if (!cfg.bucket) {
    report.skip("bucket", "GCS_BUCKET_NAME is not set")
    return
  }

  const storage = new Storage({ projectId: cfg.projectId })
  const bucket = storage.bucket(cfg.bucket)
  let metadata = null

  await report.check(`bucket ${cfg.bucket} exists`, async () => {
    const [exists] = await bucket.exists()
    if (!exists) throw failure("not found", "terraform apply, or check GCS_BUCKET_NAME")
    const [meta] = await bucket.getMetadata()
    metadata = meta
    return { detail: `${meta.location} · ${meta.storageClass}` }
  })

  await report.check("bucket is not publicly accessible", async () => {
    const prevention = metadata?.iamConfiguration?.publicAccessPrevention
    if (prevention !== "enforced") {
      throw failure(
        `publicAccessPrevention is "${prevention ?? "unset"}"`,
        `gcloud storage buckets update gs://${cfg.bucket} --public-access-prevention`,
      )
    }
    const uniform = metadata?.iamConfiguration?.uniformBucketLevelAccess?.enabled
    if (!uniform) return { warn: "uniform bucket-level access is off, so ACLs still apply" }
    return { detail: "public access prevented, uniform access on" }
  })

  await report.check("CORS is configured for browser uploads", async () => {
    const cors = metadata?.cors ?? []
    if (cors.length === 0) {
      throw failure(
        "no CORS configuration",
        `Without it EVERY browser upload fails while curl succeeds, because GCS\n` +
          `answers the preflight from the bucket. See infra/terraform/storage.tf.`,
      )
    }

    const origins = cors.flatMap((r) => r.origin ?? [])
    const methods = cors.flatMap((r) => r.method ?? [])

    if (!methods.includes("PUT")) {
      throw failure(
        `CORS allows ${methods.join(", ") || "nothing"} but not PUT`,
        "Add PUT to the bucket's CORS `method` list.",
      )
    }

    // GCS matches origins as exact strings or "*" — there are no partial
    // wildcards, so a "https://*.vercel.app" entry does nothing at all.
    const partial = origins.filter((o) => o.includes("*") && o !== "*")
    if (partial.length) {
      return {
        warn:
          `${partial.join(", ")} will never match — GCS takes exact strings or "*", ` +
          `with no partial wildcards`,
      }
    }

    if (origins.includes("*")) {
      return {
        warn:
          `origin is "*". Acceptable — the signed URL is the security boundary, ` +
          `not CORS — but pin it in production.`,
      }
    }

    return { detail: origins.join(", ") }
  })

  if (cfg.readOnly) {
    report.skip("signed upload round trip", "--read-only")
    report.skip("object read back", "--read-only")
    return
  }

  const key = `${cfg.prefix}/${Date.now()}-preflight.txt`
  const body = `quarry preflight ${new Date().toISOString()}\n`
  const file = bucket.file(key)

  await report.check("generate a V4 signed PUT url", async () => {
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 10 * 60 * 1000,
      contentType: "text/plain",
    })
    if (!url.includes("X-Goog-Signature")) throw new Error("url carries no signature")
    state.signedPutUrl = url
    return { detail: "signBlob path works" }
  }, {
    fix:
      "This is the signBlob path. If Identity said signBlob failed, fix that first —\n" +
      "the service account needs token-creator on itself.",
  })

  await report.check("PUT through the signed url", async () => {
    if (!state.signedPutUrl) return { skip: "no signed url" }

    const res = await fetch(state.signedPutUrl, {
      method: "PUT",
      // Byte-identical to what was signed. A different Content-Type is a
      // different request, GCS answers 403, and a browser reports it as CORS.
      headers: { "Content-Type": "text/plain" },
      body,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw failure(
        `HTTP ${res.status}`,
        text.includes("SignatureDoesNotMatch")
          ? "The Content-Type sent did not match the one signed."
          : "Check the signing account has object write on this bucket.",
      )
    }
    state.objectWritten = true
    return { detail: `${body.length} bytes written` }
  })

  await report.check("read the object back", async () => {
    if (!state.objectWritten) return { skip: "nothing was uploaded" }
    const [exists] = await file.exists()
    if (!exists) throw new Error("object is not in the bucket after a successful PUT")
    const [meta] = await file.getMetadata()
    const [contents] = await file.download()
    if (contents.toString() !== body) throw new Error("contents differ from what was written")
    return { detail: `${meta.size} bytes · generation ${meta.generation}` }
  })

  await report.check("generate and follow a signed READ url", async () => {
    if (!state.objectWritten) return { skip: "nothing was uploaded" }
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 10 * 60 * 1000,
    })
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    if (text !== body) throw new Error("signed read returned different contents")
    return { detail: "downloads will work" }
  })

  await report.check("clean up the test object", async () => {
    if (!state.objectWritten) return { skip: "nothing to clean up" }
    await file.delete({ ignoreNotFound: true })
    return { detail: key }
  })

  // The inspect worker must be structurally unable to write output. If it can,
  // least privilege is a description rather than a fact.
  await report.check("inspect worker CANNOT write output", async () => {
    if (!cfg.inspectServiceAccount) {
      return { skip: "GCP_INSPECT_SERVICE_ACCOUNT not set" }
    }

    const { Impersonated } = await import("google-auth-library")
    let impersonated
    try {
      impersonated = new Impersonated({
        sourceClient: await state.auth.getClient(),
        targetPrincipal: cfg.inspectServiceAccount,
        lifetime: 300,
        delegates: [],
        targetScopes: ["https://www.googleapis.com/auth/cloud-platform"],
      })
      await impersonated.getAccessToken()
    } catch {
      return { skip: "cannot impersonate the inspect account from here" }
    }

    const probe = `requests/${cfg.prefix}/output/negative-test.txt`
    const res = await impersonated.request({
      url:
        `https://storage.googleapis.com/upload/storage/v1/b/${cfg.bucket}/o` +
        `?uploadType=media&name=${encodeURIComponent(probe)}`,
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "should not be allowed",
    }).catch((error) => ({ status: error?.response?.status ?? error.code ?? 0 }))

    if (res.status === 200 || res.status === 201) {
      // Clean up the thing that should not have been possible.
      await bucket.file(probe).delete({ ignoreNotFound: true }).catch(() => {})
      throw failure(
        "it wrote an output object",
        `The inspect worker has write access it should not have. Check iam.tf —\n` +
          `it should hold roles/storage.objectViewer only.`,
      )
    }

    return { detail: `denied with ${res.status}, as it should be` }
  })
}
