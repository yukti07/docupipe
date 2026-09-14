# Vercel reaches GCP over OIDC. No static service-account private key exists
# anywhere in this architecture.
#
# THE THREE THINGS THAT MAKE SIGNED URLS WORK, all of which fail at request
# time in production and nowhere earlier:
#
#   1. Impersonation, not direct resource access. With no private key, V4
#      signing falls back to the IAM Credentials signBlob API, and signBlob
#      needs to know WHOSE identity to sign as. That comes from the
#      credential's client_email — and a direct-access external-account
#      credential does not have one. The failure is:
#          Error: Cannot sign data without `client_email`.
#
#   2. The serviceAccountTokenCreator SELF-binding below. It looks redundant
#      and is not: roles/storage.objectAdmin does not grant signing.
#      Without it every call to the upload endpoint returns 500 with
#          Permission 'iam.serviceAccounts.signBlob' denied.
#
#   3. The attribute condition must NOT pin environment == 'production', or
#      every preview deployment builds and deploys perfectly and then 500s at
#      runtime.

resource "google_iam_workload_identity_pool" "vercel" {
  workload_identity_pool_id = "${local.prefix}-vercel-pool"
  display_name              = "Vercel (${var.env})"
  description               = "Federates Vercel OIDC tokens to a GCP service account."
  project                   = var.project_id

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "vercel" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.vercel.workload_identity_pool_id
  workload_identity_pool_provider_id = "${local.prefix}-vercel-oidc"
  display_name                       = "Vercel OIDC"
  project                            = var.project_id

  oidc {
    # Both are team-scoped. A mismatch fails at request time with an opaque
    # STS error, so they are worth checking against the Vercel dashboard
    # rather than assuming.
    issuer_uri        = "https://oidc.vercel.com/${var.vercel_team_slug}"
    allowed_audiences = ["https://vercel.com/${var.vercel_team_slug}"]
  }

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.owner"      = "assertion.owner"
    "attribute.project"    = "assertion.project"
    "attribute.environment" = "assertion.environment"
  }

  # Pinned so only THIS project can assume the service account. An
  # unconditioned pool trusts every project in the Vercel team.
  #
  # Deliberately not pinning `environment`: previews carry
  # environment == "preview" and would be rejected at runtime while building
  # and deploying perfectly. If previews must be excluded, exclude them here
  # on purpose and say so.
  attribute_condition = join(" && ", [
    "assertion.owner == '${var.vercel_team_slug}'",
    "assertion.project == '${var.vercel_project_name}'",
  ])
}

# (1) Lets the Vercel OIDC principal impersonate the service account.
resource "google_service_account_iam_member" "vercel_wif_user" {
  service_account_id = google_service_account.vercel.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.vercel.name}/attribute.project/${var.vercel_project_name}"
}

# (2) Lets the service account sign blobs AS ITSELF. This is the one that is
#     always forgotten, and it is what makes signed URLs work at all.
resource "google_service_account_iam_member" "vercel_token_creator" {
  service_account_id = google_service_account.vercel.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.vercel.email}"
}
