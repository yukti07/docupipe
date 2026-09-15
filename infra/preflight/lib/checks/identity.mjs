import { GoogleAuth, Impersonated } from "google-auth-library"
import { failure } from "../report.mjs"

/**
 * Who am I, and can I become the service accounts the app runs as.
 *
 * The `signBlob` check is the one that matters most. With no private key
 * anywhere, V4 signed-URL generation falls back to the IAM Credentials
 * signBlob API — and two things have to be true for that to work, neither of
 * which is obvious, and both of which fail only at request time in production:
 *
 *   1. the credential must IMPERSONATE a service account, because signing
 *      needs a `client_email` and a direct-access external-account credential
 *      does not have one
 *   2. that service account needs roles/iam.serviceAccountTokenCreator ON
 *      ITSELF, which looks redundant and is not
 */

export async function run(report, cfg, state) {
  report.group("Identity and IAM")

  await report.check("Application Default Credentials resolve", async () => {
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    })
    const client = await auth.getClient()
    const credentials = await auth.getCredentials().catch(() => ({}))

    state.auth = auth
    state.principal = credentials.client_email ?? "(user credentials)"

    const token = await client.getAccessToken()
    if (!token || !token.token) throw new Error("no access token returned")

    return { detail: `acting as ${state.principal}` }
  }, {
    fix: "gcloud auth application-default login",
  })

  await report.check("project id resolves", async () => {
    if (!state.auth) return { skip: "credentials did not resolve" }
    const auth = state.auth
    const discovered = await auth.getProjectId().catch(() => null)
    if (discovered && discovered !== cfg.projectId) {
      return {
        warn:
          `ADC points at "${discovered}" but the settings say "${cfg.projectId}". ` +
          `Checks run against "${cfg.projectId}".`,
      }
    }
    return { detail: cfg.projectId }
  })

  if (!cfg.vercelServiceAccount) {
    report.skip(
      "impersonate the Vercel service account",
      "GCP_SERVICE_ACCOUNT_EMAIL is not set (pass --from-terraform)",
    )
    return
  }

  await report.check(
    `impersonate ${short(cfg.vercelServiceAccount)}`,
    async () => {
      const impersonated = new Impersonated({
        sourceClient: await state.auth.getClient(),
        targetPrincipal: cfg.vercelServiceAccount,
        lifetime: 300,
        delegates: [],
        targetScopes: ["https://www.googleapis.com/auth/cloud-platform"],
      })
      await impersonated.getAccessToken()
      state.impersonatedVercel = impersonated
      return { detail: "roles/iam.serviceAccountTokenCreator on the caller is present" }
    },
    {
      fix:
        `Grant yourself token creator on it:\n` +
        `  gcloud iam service-accounts add-iam-policy-binding ${cfg.vercelServiceAccount} \\\n` +
        `    --member="user:$(gcloud config get-value account)" \\\n` +
        `    --role="roles/iam.serviceAccountTokenCreator"`,
    },
  )

  // THE one that silently breaks every upload.
  await report.check(
    "the Vercel service account can signBlob AS ITSELF",
    async () => {
      if (!state.impersonatedVercel) {
        return { skip: "could not impersonate, so signing could not be checked" }
      }

      const url =
        `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/` +
        `${cfg.vercelServiceAccount}:signBlob`

      const res = await state.impersonatedVercel.request({
        url,
        method: "POST",
        data: { payload: Buffer.from("quarry-preflight").toString("base64") },
      }).catch((error) => {
        const message = error?.response?.data?.error?.message ?? error.message
        throw failure(
          message,
          `The service account needs token-creator on ITSELF. It looks redundant\n` +
            `and is not — roles/storage.objectAdmin does NOT grant signing:\n` +
            `  gcloud iam service-accounts add-iam-policy-binding ${cfg.vercelServiceAccount} \\\n` +
            `    --member="serviceAccount:${cfg.vercelServiceAccount}" \\\n` +
            `    --role="roles/iam.serviceAccountTokenCreator"`,
        )
      })

      if (!res.data?.signedBlob) throw new Error("signBlob returned no signature")
      return { detail: "signed URL generation will work" }
    },
  )
}

export function short(email) {
  return email ? email.split("@")[0] : "(unset)"
}
