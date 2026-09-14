# Two topics, because the Convert gate splits the pipeline into two kinds of
# work that fail, scale and cost differently (§26). Nothing subscribes to both.

# ------------------------------------------------------------------ topics

resource "google_pubsub_topic" "file_uploaded" {
  name       = local.topic_file_uploaded
  project    = var.project_id
  labels     = local.labels
  depends_on = [google_project_service.required]
}

resource "google_pubsub_topic" "convert_requested" {
  name       = local.topic_convert_requested
  project    = var.project_id
  labels     = local.labels
  depends_on = [google_project_service.required]
}

resource "google_pubsub_topic" "file_uploaded_dlq" {
  name    = "${local.topic_file_uploaded}-dlq"
  project = var.project_id
  labels  = local.labels
}

resource "google_pubsub_topic" "convert_requested_dlq" {
  name    = "${local.topic_convert_requested}-dlq"
  project = var.project_id
  labels  = local.labels
}

# ----------------------------------------------------------- subscriptions

resource "google_pubsub_subscription" "file_uploaded" {
  name    = "${local.topic_file_uploaded}-sub"
  topic   = google_pubsub_topic.file_uploaded.id
  project = var.project_id

  # Sized against the 600s lease. The lease must be longer than the work and
  # the ack deadline at least as long as the lease, or a file whose worker is
  # perfectly healthy gets stolen.
  ack_deadline_seconds = var.ack_deadline_seconds

  push_config {
    push_endpoint = google_cloud_run_v2_service.inspect.uri

    # Authenticated push. The service does not allow unauthenticated
    # invocation, so this token is the only way in.
    oidc_token {
      service_account_email = google_service_account.pubsub_invoker.email
      audience              = google_cloud_run_v2_service.inspect.uri
    }
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.file_uploaded_dlq.id
    max_delivery_attempts = var.max_delivery_attempts
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  expiration_policy {
    ttl = "" # never expire
  }

  labels = local.labels

  depends_on = [
    google_project_iam_member.pubsub_agent_token_creator,
    google_pubsub_topic_iam_member.dlq_publisher_file_uploaded,
  ]
}

resource "google_pubsub_subscription" "convert_requested" {
  name    = "${local.topic_convert_requested}-sub"
  topic   = google_pubsub_topic.convert_requested.id
  project = var.project_id

  ack_deadline_seconds = var.ack_deadline_seconds

  push_config {
    push_endpoint = google_cloud_run_v2_service.convert.uri

    oidc_token {
      service_account_email = google_service_account.pubsub_invoker.email
      audience              = google_cloud_run_v2_service.convert.uri
    }
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.convert_requested_dlq.id
    max_delivery_attempts = var.max_delivery_attempts
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  expiration_policy {
    ttl = ""
  }

  labels = local.labels

  depends_on = [
    google_project_iam_member.pubsub_agent_token_creator,
    google_pubsub_topic_iam_member.dlq_publisher_convert_requested,
  ]
}

# Pull subscriptions on the dead-letter topics. Nothing consumes them
# automatically in this phase — their job is to stop a poison message cycling
# forever and leave the evidence somewhere a human can read it.
resource "google_pubsub_subscription" "file_uploaded_dlq" {
  name                 = "${local.topic_file_uploaded}-dlq-sub"
  topic                = google_pubsub_topic.file_uploaded_dlq.id
  project              = var.project_id
  ack_deadline_seconds = 60
  message_retention_duration = "604800s" # 7 days

  expiration_policy {
    ttl = ""
  }

  labels = local.labels
}

resource "google_pubsub_subscription" "convert_requested_dlq" {
  name                 = "${local.topic_convert_requested}-dlq-sub"
  topic                = google_pubsub_topic.convert_requested_dlq.id
  project              = var.project_id
  ack_deadline_seconds = 60
  message_retention_duration = "604800s"

  expiration_policy {
    ttl = ""
  }

  labels = local.labels
}
