variable "project_id" {
  description = "GCP project id. Provided by the human administrator; not a secret."
  type        = string
}

variable "project_number" {
  description = "GCP project number. Needed to name the Pub/Sub service agent."
  type        = string
}

variable "region" {
  description = "Every regional resource goes here. Vercel's function region must be co-located with it, or every query crosses an ocean."
  type        = string
  default     = "asia-south1"
}

variable "env" {
  description = "Environment suffix used in every resource name."
  type        = string
  default     = "dev"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,12}$", var.env))
    error_message = "env must be lowercase letters, digits and hyphens."
  }
}

variable "name_prefix" {
  description = "Prefix for every resource name."
  type        = string
  default     = "quarry"
}

# ----------------------------------------------------------------- storage

variable "cors_origins" {
  description = <<-EOT
    Origins allowed to PUT directly to the bucket.

    GCS matches these as exact strings or "*" — there are no partial
    wildcards, so "https://*.vercel.app" does nothing. Vercel preview
    deployments each get their own hostname, so a dev bucket needs "*" or
    previews cannot upload.

    "*" is acceptable here: CORS is not the security boundary, the signed URL
    is. An allowed origin still cannot write anything without a valid,
    unexpired, server-issued signature.
  EOT
  type        = list(string)
  default     = ["*"]
}

variable "input_retention_days" {
  description = "Delete uploaded objects after this many days. 0 disables the rule."
  type        = number
  default     = 30
}

# ---------------------------------------------------------------- database

variable "db_tier" {
  description = "Cloud SQL machine type. db-f1-micro is enough for this phase and is the cheapest thing that exists."
  type        = string
  default     = "db-f1-micro"
}

variable "db_name" {
  type    = string
  default = "quarry"
}

variable "db_user" {
  type    = string
  default = "quarry_app"
}

variable "db_deletion_protection" {
  description = "Leave true for anything anyone cares about."
  type        = bool
  default     = false
}

# -------------------------------------------------------------- cloud run

variable "worker_image" {
  description = <<-EOT
    Placeholder only. The deployment pipeline owns this field at runtime and
    Terraform ignores changes to it (see cloud-run.tf) — otherwise the next
    `apply` silently reverts production to whatever image is in state.

    The placeholder exists so the service can be created BEFORE the first
    image is built.
  EOT
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "inspect_max_instances" {
  description = "Runs on every file at upload, including files never converted. Short work, so more headroom."
  type        = number
  default     = 5
}

variable "convert_max_instances" {
  description = "Long work, and expensive later. Bounded lower on purpose."
  type        = number
  default     = 3
}

variable "request_timeout_seconds" {
  description = "Must exceed the Pub/Sub ack deadline, or a healthy worker is killed mid-run."
  type        = number
  default     = 900

  validation {
    condition     = var.request_timeout_seconds > 600
    error_message = "Must be greater than the 600s Pub/Sub ack deadline."
  }
}

# ---------------------------------------------------------------- pub/sub

variable "ack_deadline_seconds" {
  description = "600 is the maximum for a push subscription, and it is what the 600s lease is sized against."
  type        = number
  default     = 600
}

variable "max_delivery_attempts" {
  description = "After this many, a message goes to the dead-letter topic instead of cycling forever."
  type        = number
  default     = 5
}

# ------------------------------------------------------------------ vercel

variable "vercel_team_slug" {
  description = "Vercel team slug. Part of the OIDC issuer and audience, and both must match exactly or every request fails at runtime."
  type        = string
}

variable "vercel_project_name" {
  description = "Pinned in the WIF attribute condition so only this project can assume the service account."
  type        = string
}

# ------------------------------------------------------------- monitoring

variable "alert_notification_channels" {
  description = "Cloud Monitoring channel ids. An alert policy with no channel is a dashboard nobody looks at."
  type        = list(string)
  default     = []
}
