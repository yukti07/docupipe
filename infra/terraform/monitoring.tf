# The health endpoint is only worth building if something reads it.
#
# Every policy here corresponds to a failure the system recovers from on its
# own but should not be recovering from silently and forever.

resource "google_monitoring_alert_policy" "dlq_depth" {
  count = length(var.alert_notification_channels) > 0 ? 1 : 0

  project      = var.project_id
  display_name = "${local.prefix} — dead-letter queue is not empty"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      A message gave up permanently and landed on a dead-letter topic.

      Nothing consumes the DLQ automatically. Pull from the
      *-dlq-sub subscription to see what it was, then decide whether the file
      needs re-uploading or the worker needs fixing.
    EOT
  }

  conditions {
    display_name = "DLQ has messages"
    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"pubsub_subscription\"",
        "metric.type = \"pubsub.googleapis.com/subscription/num_undelivered_messages\"",
        "resource.label.subscription_id = monitoring.regex.full_match(\".*-dlq-sub\")",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MAX"
      }
    }
  }

  notification_channels = var.alert_notification_channels
  depends_on            = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "oldest_unacked" {
  count = length(var.alert_notification_channels) > 0 ? 1 : 0

  project      = var.project_id
  display_name = "${local.prefix} — messages are not being processed"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      Messages have been sitting unacknowledged for longer than the ack
      deadline allows for.

      Usual causes, in order of likelihood: the worker is failing to start;
      max_instance_count is too low for the backlog; or every delivery is
      nacking because a lease is held by an instance that will never finish.

      Check /healthz on the worker — `queue.stuck` above zero points at the
      third.
    EOT
  }

  conditions {
    display_name = "Oldest unacked message > 15 minutes"
    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"pubsub_subscription\"",
        "metric.type = \"pubsub.googleapis.com/subscription/oldest_unacked_message_age\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = 900
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MAX"
      }
    }
  }

  notification_channels = var.alert_notification_channels
  depends_on            = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "db_connections" {
  count = length(var.alert_notification_channels) > 0 ? 1 : 0

  project      = var.project_id
  display_name = "${local.prefix} — database connections near the limit"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      Connection exhaustion presents as unrelated 500s all over the API and is
      very hard to diagnose from the symptom, which is why this alert exists
      rather than a runbook entry.

      The fix is to bound the pools, not to raise max_connections: every warm
      Vercel function instance holds its own pool and concurrency is not
      shared between them.
    EOT
  }

  conditions {
    display_name = "num_backends > 70"
    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloudsql_database\"",
        "metric.type = \"cloudsql.googleapis.com/database/postgresql/num_backends\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = 70
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = var.alert_notification_channels
  depends_on            = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "sweep_stopped" {
  count = length(var.alert_notification_channels) > 0 ? 1 : 0

  project      = var.project_id
  display_name = "${local.prefix} — the scheduled sweep has stopped"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      Cloud Scheduler has been failing to reach /internal/sweep.

      This is the quietest serious failure in the system: everything keeps
      working, files keep being accepted, and nothing recovers. A failed
      publish stays unpublished, a dead worker's file stays claimed, and a
      parked request never resumes.
    EOT
  }

  conditions {
    display_name = "Scheduler job failing"
    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloud_scheduler_job\"",
        "metric.type = \"cloudscheduler.googleapis.com/job/attempt_count\"",
        "metric.label.state != \"success\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = 3
      duration        = "600s"
      aggregations {
        alignment_period   = "600s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  notification_channels = var.alert_notification_channels
  depends_on            = [google_project_service.required]
}
