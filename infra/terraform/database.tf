resource "google_sql_database_instance" "main" {
  name             = "${local.prefix}-pg"
  project          = var.project_id
  region           = var.region
  database_version = "POSTGRES_16"

  deletion_protection = var.db_deletion_protection

  settings {
    tier              = var.db_tier
    availability_type = "ZONAL"
    disk_size         = 10
    disk_type         = "PD_SSD"
    disk_autoresize   = true

    ip_configuration {
      # A public IP is required for the Vercel connector library, which is the
      # only supported way to reach Cloud SQL from a serverless function — the
      # Auth Proxy binary cannot run there.
      #
      # This is not a security regression. `authorized_networks` is
      # DELIBERATELY EMPTY: the connector reaches the public endpoint but the
      # instance rejects anything without a valid IAM-issued client
      # certificate. An empty list is what keeps everything else out.
      ipv4_enabled    = true
      ssl_mode        = "ENCRYPTED_ONLY"
      authorized_networks = []
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "20:00" # off-peak for asia-south1
      point_in_time_recovery_enabled = false
      backup_retention_settings {
        retained_backups = 7
      }
    }

    maintenance_window {
      day          = 7 # Sunday
      hour         = 21
      update_track = "stable"
    }

    database_flags {
      # Connection exhaustion shows up as unrelated 500s all over the API and
      # is very hard to diagnose from the symptom. Raising the ceiling is the
      # cheap half; bounding the pools (DB_POOL_SIZE, and `max` on the Vercel
      # side) is the half that actually matters.
      name  = "max_connections"
      value = "100"
    }

    insights_config {
      query_insights_enabled = true
    }

    user_labels = local.labels
  }

  depends_on = [google_project_service.required]
}

resource "google_sql_database" "app" {
  name     = var.db_name
  instance = google_sql_database_instance.main.name
  project  = var.project_id
}

# Generated here rather than asked for. Nobody types this, nobody pastes it
# into a chat, and it only ever moves between Secret Manager and a runtime.
resource "random_password" "db" {
  length  = 32
  special = true
  # Keep it URL-safe: this ends up in a DATABASE_URL more often than anyone
  # intends, and a '/' or '@' in a password produces a parse error that looks
  # like an auth failure.
  override_special = "-_.~"
}

resource "google_sql_user" "app" {
  name     = var.db_user
  instance = google_sql_database_instance.main.name
  project  = var.project_id
  password = random_password.db.result
}

resource "google_secret_manager_secret" "db_password" {
  secret_id = "${local.prefix}-db-password"
  project   = var.project_id

  replication {
    auto {}
  }

  labels     = local.labels
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.db.result
}

# The session cookie's signing key (§12.2). Rotating it logs everyone out,
# which is correct and acceptable behaviour.
resource "random_password" "session_secret" {
  length  = 64
  special = false
}

resource "google_secret_manager_secret" "session_secret" {
  secret_id = "${local.prefix}-session-secret"
  project   = var.project_id

  replication {
    auto {}
  }

  labels     = local.labels
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "session_secret" {
  secret      = google_secret_manager_secret.session_secret.id
  secret_data = random_password.session_secret.result
}
