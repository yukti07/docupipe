# What the human administrator copies into Vercel after `apply`.
# These are configuration identifiers, not credentials.

output "vercel_env" {
  description = "Paste these into Vercel's environment variables."
  value = {
    GCP_PROJECT_ID                         = var.project_id
    GCP_PROJECT_NUMBER                     = var.project_number
    GCP_REGION                             = var.region
    GCS_BUCKET_NAME                        = google_storage_bucket.uploads.name
    PUBSUB_TOPIC_FILE_UPLOADED             = google_pubsub_topic.file_uploaded.name
    PUBSUB_TOPIC_CONVERT_REQUESTED         = google_pubsub_topic.convert_requested.name
    GCP_SERVICE_ACCOUNT_EMAIL              = google_service_account.vercel.email
    GCP_WORKLOAD_IDENTITY_POOL_ID          = google_iam_workload_identity_pool.vercel.workload_identity_pool_id
    GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = google_iam_workload_identity_pool_provider.vercel.workload_identity_pool_provider_id
    INSTANCE_CONNECTION_NAME               = google_sql_database_instance.main.connection_name
    DB_NAME                                = google_sql_database.app.name
    DB_USER                                = google_sql_user.app.name
  }
}

output "workload_identity_audience" {
  description = "The `audience` field of the external-account credential config. Must include service_account_impersonation_url, or signed URLs fail with 'Cannot sign data without client_email'."
  value       = "//iam.googleapis.com/${google_iam_workload_identity_pool.vercel.name}/providers/${google_iam_workload_identity_pool_provider.vercel.workload_identity_pool_provider_id}"
}

output "service_account_impersonation_url" {
  description = "Required in the credential config. Without it, signing has no identity to sign as."
  value       = "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${google_service_account.vercel.email}:generateAccessToken"
}

output "worker_image_repository" {
  description = "Push the worker image here, then deploy it to both services BY DIGEST."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.worker.repository_id}/worker"
}

output "inspect_service_url" {
  value = google_cloud_run_v2_service.inspect.uri
}

output "convert_service_url" {
  value = google_cloud_run_v2_service.convert.uri
}

output "bucket_name" {
  value = google_storage_bucket.uploads.name
}

output "db_password_secret" {
  description = "Secret Manager id. The value never leaves Secret Manager and is never printed here."
  value       = google_secret_manager_secret.db_password.secret_id
}

output "session_secret_id" {
  description = "Secret Manager id for the cookie signing key."
  value       = google_secret_manager_secret.session_secret.secret_id
}

output "migration_database_url_hint" {
  description = "How to reach the database to run migrations. Password comes from Secret Manager, never from here."
  value       = "Run: cloud-sql-proxy ${google_sql_database_instance.main.connection_name} --port 5432, then DATABASE_URL=postgresql://${google_sql_user.app.name}:$(gcloud secrets versions access latest --secret=${google_secret_manager_secret.db_password.secret_id})@127.0.0.1:5432/${google_sql_database.app.name}"
  sensitive   = false
}
