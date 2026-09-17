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

/** Tests change the environment between cases. */
export function resetGcpAuthClient(): void {
  cached = undefined
}
