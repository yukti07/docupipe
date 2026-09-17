#!/usr/bin/env bash
#
# The infrastructure half of the fixes. Read it before you run it — every line
# changes who can reach what, or where a message goes.
#
# Idempotent: each command sets a value rather than appending one, so running
# it twice is the same as running it once.
set -euo pipefail

PROJECT=project-cf6fd144-baf2-463b-9cd
REGION=asia-south1
SA_PUBSUB=quarry-pubsub-invoker@${PROJECT}.iam.gserviceaccount.com

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

INSPECT_URL=$(gcloud run services describe quarry-inspect-worker --region="$REGION" --project="$PROJECT" --format='value(status.url)')
CONVERT_URL=$(gcloud run services describe quarry-convert-worker --region="$REGION" --project="$PROJECT" --format='value(status.url)')
echo "inspect: $INSPECT_URL"
echo "convert: $CONVERT_URL"

# ------------------------------------------------------------------ 1
# quarry-file-uploaded-push was aimed at zamp-schema-detector in us-central1,
# which is a different deployment of the same image, and carried no OIDC token
# at all — so every push to the private service was refused before it arrived.
say "repointing the schema-detection push at the asia-south1 worker, with OIDC"
gcloud pubsub subscriptions update quarry-file-uploaded-push \
  --project="$PROJECT" \
  --push-endpoint="${INSPECT_URL}/" \
  --push-auth-service-account="$SA_PUBSUB"

# ------------------------------------------------------------------ 2
# The conversion push already carries OIDC. Re-set the endpoint anyway so both
# subscriptions name the same URL form and there is one fewer thing to compare.
say "normalising the conversion push endpoint"
gcloud pubsub subscriptions update quarry-convert-requested-push \
  --project="$PROJECT" \
  --push-endpoint="${CONVERT_URL}/" \
  --push-auth-service-account="$SA_PUBSUB"

# ------------------------------------------------------------------ 3
# The sweep jobs have been returning NOT_FOUND once a minute because the
# deployed worker served no /internal/sweep. It does now, so this only
# confirms they point at the right place.
say "sweep jobs"
for pair in "quarry-inspect-sweep:$INSPECT_URL" "quarry-convert-sweep:$CONVERT_URL"; do
  job=${pair%%:*}; url=${pair#*:}
  gcloud scheduler jobs update http "$job" \
    --project="$PROJECT" --location="$REGION" \
    --uri="${url}/internal/sweep" \
    --oidc-service-account-email="quarry-scheduler-invoker@${PROJECT}.iam.gserviceaccount.com" \
    --oidc-token-audience="$url" \
    --quiet
  echo "  ok  $job -> ${url}/internal/sweep"
done

# ------------------------------------------------------------------ 4
# The sweep relays the outbox, which means publishing. The runtime accounts
# were never granted it because the previous worker never published.
say "granting the worker accounts pubsub.publisher (the sweep relays the outbox)"
for sa in quarry-inspect-worker quarry-convert-worker; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${sa}@${PROJECT}.iam.gserviceaccount.com" \
    --role=roles/pubsub.publisher --condition=None --quiet >/dev/null
  echo "  ok  $sa -> roles/pubsub.publisher"
done

say "done — now re-run: node infra/e2e/e2e-flow.mjs --preflight-only"

# ------------------------------------------------------------------ note
# NOT done here, deliberately:
#
#   zamp-schema-detector and zamp-data-processor in us-central1 are duplicate
#   deployments of the same two images. Nothing points at them any more. They
#   are left alone rather than deleted, because deleting a running service is
#   not a thing a fix script should decide.
#
#   The bucket is multi-region US while the workers are in asia-south1. Every
#   file is read cross-region. Moving it is a migration, not a flag.
