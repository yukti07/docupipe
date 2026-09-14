# Two services from ONE image. SERVICE_ROLE selects the processor.
#
# OWNERSHIP, and why the lifecycle block below is not optional:
#
#   Terraform owns the service's SHAPE — service account, env vars, Cloud SQL
#   attachment, scaling, probes, IAM.
#   The deployment pipeline owns the service's IMAGE.
#
# If both claim `image`, the next `terraform apply` silently reverts
# production to whatever is in state. `terraform plan` must be EMPTY after a
# pipeline deploy; if it is not, this block is wrong.

locals {
  worker_env_common = {
    STORAGE_BACKEND                = "gcs"
    GCS_BUCKET_NAME                = google_storage_bucket.uploads.name
    GCP_PROJECT_ID                 = var.project_id
    PUBSUB_TOPIC_FILE_UPLOADED     = google_pubsub_topic.file_uploaded.name
    PUBSUB_TOPIC_CONVERT_REQUESTED = google_pubsub_topic.convert_requested.name
    INSTANCE_CONNECTION_NAME       = google_sql_database_instance.main.connection_name
    DB_NAME                        = google_sql_database.app.name
    DB_USER                        = google_sql_user.app.name
    DB_POOL_SIZE                   = "2"
    # Must be <= the Pub/Sub ack deadline, or a healthy worker gets its file
    # stolen while it is still working on it.
    LEASE_SECONDS                  = tostring(var.ack_deadline_seconds)
    MAX_ATTEMPTS                   = "5"
    OUTBOX_MAX_ATTEMPTS            = "10"
    LOG_LEVEL                      = "INFO"
  }
}

resource "google_cloud_run_v2_service" "inspect" {
  name     = local.service_inspect
  location = var.region
  project  = var.project_id

  ingress = "INGRESS_TRAFFIC_ALL"
  labels  = local.labels

  template {
    service_account = google_service_account.inspect_worker.email

    # Concurrency 1: the processor is CPU-bound and holds a database
    # connection per request. With concurrency 1, max_instance_count IS the
    # parallelism of the whole system — at 1, every message beyond the first
    # waits past the ack deadline and is redelivered, so a queue that is
    # merely busy looks exactly like a queue that is failing.
    max_instance_request_concurrency = 1
    timeout                          = "${var.request_timeout_seconds}s"

    scaling {
      min_instance_count = 0
      max_instance_count = var.inspect_max_instances
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }

    containers {
      image = var.worker_image

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }

      env {
        name  = "SERVICE_ROLE"
        value = "inspect"
      }

      dynamic "env" {
        for_each = local.worker_env_common
        content {
          name  = env.key
          value = env.value
        }
      }

      env {
        name = "DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.db_password.secret_id
            version = "latest"
          }
        }
      }

      # Both probes point at /health, which touches nothing. A probe on
      # /readyz or /healthz would restart the container when the database
      # blips, turning a five-minute incident into a thirty-minute one.
      startup_probe {
        http_get { path = "/health" }
        initial_delay_seconds = 0
        period_seconds        = 5
        failure_threshold     = 12
        timeout_seconds       = 3
      }

      liveness_probe {
        http_get { path = "/health" }
        period_seconds  = 30
        timeout_seconds = 3
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_project_service.required,
    google_secret_manager_secret_version.db_password,
    google_secret_manager_secret_iam_member.db_password_readers,
  ]
}

resource "google_cloud_run_v2_service" "convert" {
  name     = local.service_convert
  location = var.region
  project  = var.project_id

  ingress = "INGRESS_TRAFFIC_ALL"
  labels  = local.labels

  template {
    service_account = google_service_account.convert_worker.email

    max_instance_request_concurrency = 1
    timeout                          = "${var.request_timeout_seconds}s"

    scaling {
      min_instance_count = 0
      max_instance_count = var.convert_max_instances
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }

    containers {
      image = var.worker_image

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      resources {
        limits = {
          cpu = "1"
          # More than inspect: this is the one that grows into the real
          # extraction engine.
          memory = "1Gi"
        }
        cpu_idle = true
      }

      env {
        name  = "SERVICE_ROLE"
        value = "convert"
      }

      dynamic "env" {
        for_each = local.worker_env_common
        content {
          name  = env.key
          value = env.value
        }
      }

      env {
        name = "DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.db_password.secret_id
            version = "latest"
          }
        }
      }

      startup_probe {
        http_get { path = "/health" }
        initial_delay_seconds = 0
        period_seconds        = 5
        failure_threshold     = 12
        timeout_seconds       = 3
      }

      liveness_probe {
        http_get { path = "/health" }
        period_seconds  = 30
        timeout_seconds = 3
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_project_service.required,
    google_secret_manager_secret_version.db_password,
    google_secret_manager_secret_iam_member.db_password_readers,
  ]
}
