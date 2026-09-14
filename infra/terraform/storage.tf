resource "google_storage_bucket" "uploads" {
  name     = local.bucket_name
  location = var.region
  project  = var.project_id

  # No ACLs. One way to grant access, which is IAM.
  uniform_bucket_level_access = true

  # Never publicly writable, and never publicly readable. Every read goes
  # through a signed URL issued by the API.
  public_access_prevention = "enforced"

  # Required for the browser to PUT directly. GCS answers the preflight from
  # here, NOT from the signed URL — a bucket with no CORS fails every browser
  # upload while curl succeeds, which is why the test for this has to be run
  # from a browser.
  cors {
    origin          = var.cors_origins
    method          = ["PUT", "GET", "HEAD", "OPTIONS"]
    response_header = ["Content-Type", "Content-Length", "ETag", "x-goog-generation"]
    max_age_seconds = 3600
  }

  versioning {
    enabled = false
  }

  dynamic "lifecycle_rule" {
    for_each = var.input_retention_days > 0 ? [1] : []
    content {
      condition {
        age            = var.input_retention_days
        matches_prefix = ["requests/"]
      }
      action {
        type = "Delete"
      }
    }
  }

  # An upload that is started and abandoned leaves nothing behind to pay for.
  lifecycle_rule {
    condition {
      age = 1
    }
    action {
      type = "AbortIncompleteMultipartUpload"
    }
  }

  labels = local.labels

  depends_on = [google_project_service.required]
}
