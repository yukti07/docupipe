# Terraform enables the APIs it needs. `disable_on_destroy = false` matters:
# turning an API off on destroy can break unrelated things in the same project
# that happen to use it.

locals {
  required_apis = [
    "storage.googleapis.com",
    "pubsub.googleapis.com",
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "sqladmin.googleapis.com",
    "iam.googleapis.com",
    # Required for signed URLs over Workload Identity Federation. With no
    # private key anywhere, signing goes through IAM Credentials signBlob.
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "monitoring.googleapis.com",
  ]
}

resource "google_project_service" "required" {
  for_each = toset(local.required_apis)

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
