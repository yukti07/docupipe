locals {
  prefix = "${var.name_prefix}-${var.env}"

  # Bucket names are globally unique, so a project-scoped suffix is not
  # optional.
  bucket_name = "${local.prefix}-uploads-${random_id.suffix.hex}"

  topic_file_uploaded     = "${local.prefix}-file-uploaded"
  topic_convert_requested = "${local.prefix}-convert-requested"

  service_inspect = "${local.prefix}-inspect-worker"
  service_convert = "${local.prefix}-convert-worker"

  labels = {
    app         = var.name_prefix
    environment = var.env
    managed_by  = "terraform"
  }

  # The Pub/Sub service agent. It needs explicit grants for dead-lettering to
  # work at all — without them the policy is configured and silently does
  # nothing, which looks exactly like it working.
  pubsub_agent = "serviceAccount:service-${var.project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "random_id" "suffix" {
  byte_length = 4
}
