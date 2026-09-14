# Least privilege, per service account. Nothing here grants Owner or Editor.

# ------------------------------------------------- storage: reads vs writes

# The inspect worker READS input and nothing else. It is structurally unable
# to write an output object.
resource "google_storage_bucket_iam_member" "inspect_reader" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.inspect_worker.email}"
}

# The convert worker reads input and writes output.
resource "google_storage_bucket_iam_member" "convert_reader" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.convert_worker.email}"
}

resource "google_storage_bucket_iam_member" "convert_writer" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.convert_worker.email}"
}

# The API signs URLs, verifies objects exist, and serves reads back.
resource "google_storage_bucket_iam_member" "vercel_admin" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.vercel.email}"
}

# ------------------------------------------------------------- cloud sql

resource "google_project_iam_member" "sql_client" {
  for_each = toset([
    google_service_account.inspect_worker.email,
    google_service_account.convert_worker.email,
    google_service_account.vercel.email,
  ])

  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${each.value}"
}

# --------------------------------------------------------------- secrets

resource "google_secret_manager_secret_iam_member" "db_password_readers" {
  for_each = toset([
    google_service_account.inspect_worker.email,
    google_service_account.convert_worker.email,
  ])

  secret_id = google_secret_manager_secret.db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${each.value}"
  project   = var.project_id
}

# Only the API signs cookies. Neither worker has any use for this.
resource "google_secret_manager_secret_iam_member" "session_secret_vercel" {
  secret_id = google_secret_manager_secret.session_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.vercel.email}"
  project   = var.project_id
}

# --------------------------------------------------------------- pub/sub

# The API publishes to both topics.
resource "google_pubsub_topic_iam_member" "vercel_publisher" {
  for_each = {
    file_uploaded     = google_pubsub_topic.file_uploaded.name
    convert_requested = google_pubsub_topic.convert_requested.name
  }

  topic   = each.value
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.vercel.email}"
  project = var.project_id
}

# Both workers publish too — the sweep re-enqueues a reclaimed file through
# the outbox, and that goes back onto whichever topic matches its stage.
resource "google_pubsub_topic_iam_member" "worker_publisher" {
  for_each = {
    "inspect-file"     = { topic = google_pubsub_topic.file_uploaded.name, sa = google_service_account.inspect_worker.email }
    "inspect-convert"  = { topic = google_pubsub_topic.convert_requested.name, sa = google_service_account.inspect_worker.email }
    "convert-file"     = { topic = google_pubsub_topic.file_uploaded.name, sa = google_service_account.convert_worker.email }
    "convert-convert"  = { topic = google_pubsub_topic.convert_requested.name, sa = google_service_account.convert_worker.email }
  }

  topic   = each.value.topic
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${each.value.sa}"
  project = var.project_id
}

# Dead-lettering needs TWO explicit grants to the Pub/Sub service agent. Miss
# either and the policy is configured and silently does nothing, which looks
# exactly like it working right up until a poison message cycles forever.
resource "google_project_iam_member" "pubsub_agent_token_creator" {
  project = var.project_id
  role    = "roles/iam.serviceAccountTokenCreator"
  member  = local.pubsub_agent
}

resource "google_pubsub_topic_iam_member" "dlq_publisher_file_uploaded" {
  topic   = google_pubsub_topic.file_uploaded_dlq.name
  role    = "roles/pubsub.publisher"
  member  = local.pubsub_agent
  project = var.project_id
}

resource "google_pubsub_topic_iam_member" "dlq_publisher_convert_requested" {
  topic   = google_pubsub_topic.convert_requested_dlq.name
  role    = "roles/pubsub.publisher"
  member  = local.pubsub_agent
  project = var.project_id
}

resource "google_pubsub_subscription_iam_member" "dlq_subscriber_file_uploaded" {
  subscription = google_pubsub_subscription.file_uploaded.name
  role         = "roles/pubsub.subscriber"
  member       = local.pubsub_agent
  project      = var.project_id
}

resource "google_pubsub_subscription_iam_member" "dlq_subscriber_convert_requested" {
  subscription = google_pubsub_subscription.convert_requested.name
  role         = "roles/pubsub.subscriber"
  member       = local.pubsub_agent
  project      = var.project_id
}

# ------------------------------------------------------ cloud run invokers

# Each subscription can reach ONLY its own service.
resource "google_cloud_run_v2_service_iam_member" "pubsub_invoke_inspect" {
  name     = google_cloud_run_v2_service.inspect.name
  location = google_cloud_run_v2_service.inspect.location
  project  = var.project_id
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.pubsub_invoker.email}"
}

resource "google_cloud_run_v2_service_iam_member" "pubsub_invoke_convert" {
  name     = google_cloud_run_v2_service.convert.name
  location = google_cloud_run_v2_service.convert.location
  project  = var.project_id
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.pubsub_invoker.email}"
}

# The scheduler reaches both, because the sweep may run against either.
resource "google_cloud_run_v2_service_iam_member" "scheduler_invoke_inspect" {
  name     = google_cloud_run_v2_service.inspect.name
  location = google_cloud_run_v2_service.inspect.location
  project  = var.project_id
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler_invoker.email}"
}

resource "google_cloud_run_v2_service_iam_member" "scheduler_invoke_convert" {
  name     = google_cloud_run_v2_service.convert.name
  location = google_cloud_run_v2_service.convert.location
  project  = var.project_id
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler_invoker.email}"
}
