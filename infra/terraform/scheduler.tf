# The recovery trigger. NOT OPTIONAL.
#
# It is the only thing that recovers an outbox row whose publish failed, a
# file whose worker died holding the lease, and a request parked on a limit
# whose resume time has passed. None of those produce a message of their own,
# so without the timer they wait for a coincidence.
#
# A system with a broken sweep looks completely healthy right up until the
# first failure it was supposed to catch.

resource "google_cloud_scheduler_job" "sweep" {
  name        = "${local.prefix}-sweep"
  project     = var.project_id
  region      = var.region
  description = "Outbox relay, lease reaper, and resume of parked requests."
  schedule    = "* * * * *" # every minute
  time_zone   = "Etc/UTC"

  attempt_deadline = "60s"

  retry_config {
    retry_count          = 1
    min_backoff_duration = "5s"
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.inspect.uri}/internal/sweep"
    body        = base64encode("{}")

    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.scheduler_invoker.email
      audience              = google_cloud_run_v2_service.inspect.uri
    }
  }

  depends_on = [
    google_project_service.required,
    google_cloud_run_v2_service_iam_member.scheduler_invoke_inspect,
  ]
}
