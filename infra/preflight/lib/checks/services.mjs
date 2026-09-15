import { GoogleAuth } from "google-auth-library"
import { failure } from "../report.mjs"

/**
 * Cloud Run, Secret Manager, Scheduler and the enabled APIs.
 *
 * The Cloud Run checks are a matched pair: the service must answer an
 * authenticated call AND refuse an anonymous one. Only testing the first would
 * pass just as happily on a service open to the internet.
 */

export async function runServices(report, cfg, state) {
  report.group("Cloud Run")

  const services = [
    { label: "inspect", url: cfg.inspectServiceUrl },
    { label: "convert", url: cfg.convertServiceUrl },
  ]

  for (const { label, url } of services) {
    if (!url) {
      report.skip(`${label} worker`, "service url not set (pass --from-terraform)")
      continue
    }

    await report.check(`${label} worker refuses anonymous callers`, async () => {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(20_000) })
      if (res.ok) {
        throw failure(
          `it answered ${res.status} with no credentials`,
          `The service allows unauthenticated invocation. Remove allUsers from its\n` +
            `IAM policy — Pub/Sub and Scheduler both call it with OIDC tokens.`,
        )
      }
      if (res.status !== 401 && res.status !== 403) {
        return { warn: `expected 401/403, got ${res.status}` }
      }
      return { detail: `${res.status} as expected` }
    })

    await report.check(`${label} worker answers an authenticated call`, async () => {
      const auth = state.auth ?? new GoogleAuth()
      let client
      try {
        client = await auth.getIdTokenClient(url)
      } catch (error) {
        throw failure(error.message, "The caller needs roles/run.invoker on this service.")
      }

      const res = await client.request({ url: `${url}/health`, method: "GET" })
      if (res.data?.status !== "ok") {
        throw new Error(`unexpected body: ${JSON.stringify(res.data).slice(0, 120)}`)
      }
      return { detail: "liveness ok" }
    })

    await report.check(`${label} worker can reach its dependencies`, async () => {
      const auth = state.auth ?? new GoogleAuth()
      const client = await auth.getIdTokenClient(url)

      const res = await client
        .request({ url: `${url}/readyz`, method: "GET", validateStatus: () => true })
        .catch((error) => ({ status: error?.response?.status, data: error?.response?.data }))

      const checks = res.data?.checks ?? {}
      const broken = Object.entries(checks).filter(([, v]) => v !== "ok")

      if (broken.length) {
        throw failure(
          broken.map(([k, v]) => `${k}: ${v}`).join(", "),
          `The service is running but cannot reach something. For "database", check\n` +
            `the Cloud SQL instance is attached to the service and the worker's\n` +
            `service account has roles/cloudsql.client.`,
        )
      }
      return { detail: Object.keys(checks).join(", ") || "reported ready" }
    })

    await report.check(`${label} worker reports queue state`, async () => {
      const auth = state.auth ?? new GoogleAuth()
      const client = await auth.getIdTokenClient(url)
      const res = await client.request({ url: `${url}/healthz`, method: "GET" })
      const { status, queue, outbox } = res.data ?? {}

      if (!queue || !outbox) return { warn: "no queue/outbox counts in the response" }

      // A backlog here means the scheduled sweep has stopped, which is the
      // quietest serious failure in the system: everything keeps working and
      // nothing recovers.
      if (outbox.oldest_pending_age_s > 300) {
        throw failure(
          `outbox backlog ${outbox.oldest_pending_age_s}s old`,
          "The scheduled sweep is not running. Check the Cloud Scheduler job.",
        )
      }
      if (queue.stuck > 0) {
        return { warn: `${queue.stuck} files with expired leases awaiting the reaper` }
      }

      return {
        detail:
          `${status} · queued ${queue.queued} · processing ${queue.processing} · ` +
          `outbox pending ${outbox.pending}`,
      }
    })
  }
}

export async function runSecrets(report, cfg) {
  report.group("Secret Manager")

  const secrets = [
    { id: cfg.dbPasswordSecret, label: "database password" },
    { id: cfg.sessionSecret, label: "session signing key" },
  ]

  const { SecretManagerServiceClient } = await import("@google-cloud/secret-manager")
  const client = new SecretManagerServiceClient()

  for (const { id, label } of secrets) {
    if (!id) {
      report.skip(label, "secret id not set")
      continue
    }
    await report.check(`${label} (${id}) is readable`, async () => {
      const name = `projects/${cfg.projectId}/secrets/${id}/versions/latest`
      const [version] = await client.accessSecretVersion({ name })
      const bytes = version.payload?.data?.length ?? 0
      if (bytes === 0) throw new Error("the secret is empty")
      // Length only. The value never appears in this output.
      return { detail: `${bytes} bytes (value not shown)` }
    }, {
      fix: "Grant roles/secretmanager.secretAccessor on the secret.",
    })
  }
}

export async function runScheduler(report, cfg, state) {
  report.group("Cloud Scheduler")

  await report.check("the sweep job exists and is authenticated", async () => {
    const auth = state.auth ?? new GoogleAuth()
    const client = await auth.getClient()
    const parent = `projects/${cfg.projectId}/locations/${cfg.region}`

    const res = await client.request({
      url: `https://cloudscheduler.googleapis.com/v1/${parent}/jobs`,
      method: "GET",
    }).catch((error) => {
      throw failure(
        error?.response?.data?.error?.message ?? error.message,
        "Enable cloudscheduler.googleapis.com and grant roles/cloudscheduler.viewer.",
      )
    })

    const jobs = res.data?.jobs ?? []
    const sweep = jobs.find((j) => (j.httpTarget?.uri ?? "").includes("/internal/sweep"))

    if (!sweep) {
      throw failure(
        `no job targets /internal/sweep (${jobs.length} jobs in ${cfg.region})`,
        `This is NOT optional. It is the only recovery path for a failed publish,\n` +
          `a dead worker's lease, and a request parked on a limit. Without it the\n` +
          `system looks healthy right up until the first failure it should catch.`,
      )
    }

    if (!sweep.httpTarget?.oidcToken?.serviceAccountEmail) {
      throw failure(
        "the job calls the endpoint without an OIDC token",
        "Cloud Run refuses anonymous calls, so every run is failing silently.",
      )
    }

    if (sweep.state && sweep.state !== "ENABLED") {
      throw failure(`the job is ${sweep.state}`, "gcloud scheduler jobs resume " + sweep.name)
    }

    return { detail: `${sweep.schedule} · last ${sweep.lastAttemptTime ?? "never"}` }
  })
}

export async function runApis(report, cfg, state) {
  report.group("Enabled APIs")

  const required = [
    "storage.googleapis.com",
    "pubsub.googleapis.com",
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "artifactregistry.googleapis.com",
  ]

  await report.check("every required API is enabled", async () => {
    const auth = state.auth ?? new GoogleAuth()
    const client = await auth.getClient()

    const res = await client.request({
      url:
        `https://serviceusage.googleapis.com/v1/projects/${cfg.projectId}/services` +
        `?filter=state:ENABLED&pageSize=200`,
      method: "GET",
    }).catch((error) => {
      throw failure(
        error?.response?.data?.error?.message ?? error.message,
        "Grant roles/serviceusage.serviceUsageViewer, or check the API list by hand.",
      )
    })

    const enabled = new Set((res.data?.services ?? []).map((s) => s.config?.name))
    const missing = required.filter((s) => !enabled.has(s))

    if (missing.length) {
      throw failure(
        missing.join(", "),
        `gcloud services enable ${missing.join(" ")}`,
      )
    }
    return { detail: `${required.length} of ${required.length}` }
  })
}
