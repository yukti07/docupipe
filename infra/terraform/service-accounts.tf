# One service account per thing that runs, never one shared between them.
#
# The extra Terraform buys a property worth having: the inspect worker never
# writes output and never holds a model key, and the only way to keep that
# true over time is for it to be structurally unable to do either. A shared
# account makes both of those a matter of what the code happens to do today.

resource "google_service_account" "inspect_worker" {
  account_id   = "${local.prefix}-inspect"
  display_name = "Quarry inspect worker (${var.env})"
  description  = "Reads uploaded files and writes their schemas. Never writes output, never holds a model key."
  project      = var.project_id
  depends_on   = [google_project_service.required]
}

resource "google_service_account" "convert_worker" {
  account_id   = "${local.prefix}-convert"
  display_name = "Quarry convert worker (${var.env})"
  description  = "Processes approved files and writes output objects."
  project      = var.project_id
  depends_on   = [google_project_service.required]
}

resource "google_service_account" "pubsub_invoker" {
  account_id   = "${local.prefix}-pubsub-inv"
  display_name = "Quarry Pub/Sub invoker (${var.env})"
  description  = "Identity Pub/Sub push uses to call Cloud Run. Invoke only."
  project      = var.project_id
  depends_on   = [google_project_service.required]
}

resource "google_service_account" "scheduler_invoker" {
  account_id   = "${local.prefix}-sched-inv"
  display_name = "Quarry scheduler invoker (${var.env})"
  description  = "Identity Cloud Scheduler uses to call /internal/sweep."
  project      = var.project_id
  depends_on   = [google_project_service.required]
}

resource "google_service_account" "vercel" {
  account_id   = "${local.prefix}-vercel"
  display_name = "Quarry Vercel API (${var.env})"
  description  = "Impersonated by Vercel over OIDC. Signs upload URLs, publishes, reaches Cloud SQL."
  project      = var.project_id
  depends_on   = [google_project_service.required]
}
