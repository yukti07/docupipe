#!/usr/bin/env bash
#
# The IAM grants the cloud backend needs, in one place.
#
# Split out of deploy.sh because granting a role is the one step that changes
# who can reach what, and it deserves to be read before it is run rather than
# scrolling past inside a deployment.
#
# Each account gets only what its job requires (§7): the inspect worker can
# read objects but never write them, which is what makes it structurally
# unable to produce output even if its code one day tried to.
set -euo pipefail

PROJECT=project-cf6fd144-baf2-463b-9cd
PROJECT_NUMBER=29102861107
BUCKET=zamptestbucket
DB_SECRET=zampsecret

SA_INSPECT=quarry-inspect-worker@${PROJECT}.iam.gserviceaccount.com
SA_CONVERT=quarry-convert-worker@${PROJECT}.iam.gserviceaccount.com

project_role() {
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$1" --role="$2" --condition=None --quiet >/dev/null
  echo "  ok  $1 -> $2"
}

echo "project roles"
# The connector authenticates by IAM, so cloudsql.client is the whole
# database-network permission. There is no IP allowlist to maintain.
project_role "$SA_INSPECT" roles/cloudsql.client
project_role "$SA_CONVERT" roles/cloudsql.client
# Both publish: the outbox re-enqueues through Pub/Sub, and the reaper puts a
# reclaimed file back on whichever topic matches its stage.
project_role "$SA_INSPECT" roles/pubsub.publisher
project_role "$SA_CONVERT" roles/pubsub.publisher

echo "secret access"
for sa in "$SA_INSPECT" "$SA_CONVERT"; do
  gcloud secrets add-iam-policy-binding "$DB_SECRET" \
    --project="$PROJECT" --member="serviceAccount:$sa" \
    --role=roles/secretmanager.secretAccessor --quiet >/dev/null
  echo "  ok  $sa -> secretAccessor on $DB_SECRET"
done

echo "bucket access"
# Asymmetric on purpose. The inspect worker reads the uploaded object and
# writes nothing; only the convert worker produces output.
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$SA_INSPECT" --role=roles/storage.objectViewer --quiet >/dev/null
echo "  ok  $SA_INSPECT -> objectViewer on $BUCKET"
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$SA_CONVERT" --role=roles/storage.objectAdmin --quiet >/dev/null
echo "  ok  $SA_CONVERT -> objectAdmin on $BUCKET"

echo "pubsub dead-letter plumbing"
# The Pub/Sub service agent moves a message to the dead-letter topic and acks
# the original. It needs both halves, on the service's own agent account —
# a subscription with a dead-letter policy and no publisher grant silently
# retries forever instead.
AGENT="service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"
for t in file-uploaded-dlq convert-requested-dlq; do
  gcloud pubsub topics add-iam-policy-binding "$t" \
    --project="$PROJECT" --member="serviceAccount:$AGENT" \
    --role=roles/pubsub.publisher --quiet >/dev/null
  echo "  ok  pubsub agent -> publisher on $t"
done
for s in quarry-file-uploaded-push quarry-convert-requested-push; do
  gcloud pubsub subscriptions add-iam-policy-binding "$s" \
    --project="$PROJECT" --member="serviceAccount:$AGENT" \
    --role=roles/pubsub.subscriber --quiet >/dev/null 2>&1 \
    && echo "  ok  pubsub agent -> subscriber on $s" \
    || echo "  skipped $s (not created yet — re-run after deploy.sh)"
done

echo "done"
