terraform {
  required_version = ">= 1.9.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.14"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state is deliberately left to the operator to configure. Uncomment
  # and point at a bucket before anyone other than one person runs `apply` —
  # local state plus two people is how infrastructure gets created twice.
  #
  # backend "gcs" {
  #   bucket = "quarry-tfstate-<suffix>"
  #   prefix = "terraform/state"
  # }
}
