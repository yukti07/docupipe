provider "google" {
  project = var.project_id
  region  = var.region

  default_labels = {
    app         = var.name_prefix
    environment = var.env
    managed_by  = "terraform"
  }
}
