#!/usr/bin/env bash
#
# The last grants: who may invoke the two workers.
#
# Both Cloud Run services are --no-allow-unauthenticated, so nothing reaches
# them without an OIDC token. Pub/Sub mints one as the pubsub-invoker account
# and Cloud Scheduler as the scheduler-invoker account; this is what makes
# those two tokens acceptable and every other caller's not.
#
# Split from iam.sh because it can only run once the services exist.
set -euo pipefail

PROJECT=project-cf6fd144-baf2-463b-9cd
REGION=asia-south1
SA_PUBSUB=quarry-pubsub-invoker@${PROJECT}.iam.gserviceaccount.com
SA_SCHEDULER=quarry-scheduler-invoker@${PROJECT}.iam.gserviceaccount.com

echo "run.invoker"
for svc in quarry-inspect-worker quarry-convert-worker; do
  for member in "$SA_PUBSUB" "$SA_SCHEDULER"; do
    gcloud run services add-iam-policy-binding "$svc" \
      --project="$PROJECT" --region="$REGION" \
      --member="serviceAccount:$member" --role=roles/run.invoker --quiet >/dev/null
    echo "  ok  $member -> $svc"
  done
done

echo "dead-letter subscriber (needs the push subscriptions to exist)"
AGENT="service-29102861107@gcp-sa-pubsub.iam.gserviceaccount.com"
for s in quarry-file-uploaded-push quarry-convert-requested-push; do
  gcloud pubsub subscriptions add-iam-policy-binding "$s" \
    --project="$PROJECT" --member="serviceAccount:$AGENT" \
    --role=roles/pubsub.subscriber --quiet >/dev/null
  echo "  ok  pubsub agent -> subscriber on $s"
done

echo "done"
