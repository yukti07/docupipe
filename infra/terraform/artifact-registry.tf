resource "google_artifact_registry_repository" "worker" {
  repository_id = local.prefix
  location      = var.region
  project       = var.project_id
  format        = "DOCKER"
  description   = "Quarry worker images. One image, deployed twice."

  # Keep the registry from growing without limit. Untagged images are the
  # ones a rebuild orphans.
  cleanup_policies {
    id     = "keep-recent-tagged"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }

  cleanup_policies {
    id     = "delete-old-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s" # 7 days
    }
  }

  labels     = local.labels
  depends_on = [google_project_service.required]
}
