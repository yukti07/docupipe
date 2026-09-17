import "server-only"

import type { AuthClient } from "google-auth-library"

import { env } from "./env"

/**
 * The Google credential, deployed.
 *
 * There is no service-account private key anywhere in this architecture. Vercel
 * mints a short-lived OIDC token per invocation, Google's STS exchanges it for
 * a federated token, and that token IMPERSONATES the service account. The
 * federation itself lives in `infra/terraform/workload-identity.tf`.
 *
 * Two things here are load-bearing and fail only at request time:
 *
 *   `service_account_impersonation_url` is not optional. With no private key,
 *   V4 signing falls back to the IAM `signBlob` API, which has to know WHOSE
 *   identity to sign as — that comes from the credential's `client_email`, and
 *   a direct-access external-account credential does not have one. Without it
 *   every signed upload URL fails with
 *       Error: Cannot sign data without `client_email`.
 *
 *   The token comes from `@vercel/functions/oidc`, not from `process.env`.
 *   Newer Vercel runtimes deliver it per-request rather than in the
 *   environment, and the helper reads whichever one is in play.
 *
 * Locally none of the four variables below are set, this returns `undefined`,
 * and every client falls back to ADC — `gcloud auth application-default login`,
 * exactly as before.
 */

let cached: AuthClient | null | undefined

function federationConfig() {
  const cfg = env()
  const { projectNumber, workloadIdentityPoolId, workloadIdentityProviderId, serviceAccountEmail } =
    cfg

  if (
    !projectNumber ||
    !workloadIdentityPoolId ||
    !workloadIdentityProviderId ||
    !serviceAccountEmail
  ) {
    return null
  }

  return {
    audience:
      `//iam.googleapis.com/projects/${projectNumber}` +
      `/locations/global/workloadIdentityPools/${workloadIdentityPoolId}` +
      `/providers/${workloadIdentityProviderId}`,
    impersonationUrl:
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/` +
      `${serviceAccountEmail}:generateAccessToken`,
  }
}

async function build(): Promise<AuthClient | null> {
  const config = federationConfig()
  if (!config) return null

  // Lazy, like every other GCP import in this package: resolving a credential
  // at module scope fails `next build`, where there is no OIDC token.
  const { getVercelOidcToken } = await import("@vercel/functions/oidc")
  const { ExternalAccountClient } = await import("google-auth-library")

  const client = ExternalAccountClient.fromJSON({
    type: "external_account",
    audience: config.audience,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: config.impersonationUrl,
    // Called on every token refresh, so the OIDC token is always the current
    // invocation's rather than one captured when the client was built.
    subject_token_supplier: {
      getSubjectToken: () => getVercelOidcToken(),
    },
  })

  if (!client) {
    throw new Error(
      "Workload Identity Federation is configured but the credential could not " +
        "be built. Check GCP_PROJECT_NUMBER, GCP_WORKLOAD_IDENTITY_POOL_ID, " +
        "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID and GCP_SERVICE_ACCOUNT_EMAIL.",
    )
  }

  return client
}

/**
 * The credential to hand every GCP client, or `undefined` to leave them on ADC.
 *
 * Built once per warm instance. The client refreshes its own tokens; what is
 * cached here is the exchanger, not a token.
 */
export async function gcpAuthClient(): Promise<AuthClient | undefined> {
  if (cached === undefined) cached = await build()
  return cached ?? undefined
}

/* --------------------------------------------------- the ADC file path */

/**
 * The same credential, written to disk for libraries that must build their own.
 *
 * `@google-cloud/storage` resolves its OWN copy of google-auth-library (v9,
 * pinned at ^9.6.3) while this package and every other GCP client resolve v11.
 * Handing it the client above does not work, and fails in a way worth naming:
 * v9's `getCredentialsAsync` decides what to sign as with
 *
 *     if (client instanceof BaseExternalAccountClient) ...
 *
 * and `instanceof` compares class identity across module copies, so a v11
 * instance fails a v9 check. It then probes the GCE metadata server and throws
 * `Unable to find credentials in current environment` — an error that names
 * credentials when the real problem is two copies of a library.
 *
 * So Storage is left on ADC and given the credential the way ADC expects it:
 * a config file whose subject token is a second file we keep current. v9 then
 * builds its own external-account client, its own `instanceof` matches, and
 * signing works.
 */

let lastToken: string | null = null

export async function writeAdcCredentials(): Promise<void> {
  const config = federationConfig()
  if (!config) return

  const { getVercelOidcToken } = await import("@vercel/functions/oidc")
  const fs = await import("node:fs/promises")
  const path = await import("node:path")
  const os = await import("node:os")

  const token = await getVercelOidcToken()
  if (token === lastToken) return

  const tokenFile = path.join(os.tmpdir(), "vercel-oidc-token")
  const configFile = path.join(os.tmpdir(), "gcp-external-account.json")

  await fs.writeFile(tokenFile, token, "utf8")
  await fs.writeFile(
    configFile,
    JSON.stringify({
      type: "external_account",
      audience: config.audience,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      token_url: "https://sts.googleapis.com/v1/token",
      service_account_impersonation_url: config.impersonationUrl,
      credential_source: { file: tokenFile, format: { type: "text" } },
    }),
    "utf8",
  )

  process.env.GOOGLE_APPLICATION_CREDENTIALS = configFile
  lastToken = token
}

/** Tests change the environment between cases. */
export function resetGcpAuthClient(): void {
  cached = undefined
  lastToken = null
}
