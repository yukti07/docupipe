#!/usr/bin/env bash
#
# Stand the cloud backend up: two Cloud Run workers (§26), their push
# subscriptions, and the sweep schedule.
#
# Idempotent — every step either creates or updates, so re-running after a
# failure is safe. Nothing here reads or writes a password in the clear: the
# database password lives in Secret Manager and Cloud Run mounts it by
# reference, so it never lands in a shell history, a CI log or this file.
#
#   ./deploy.sh
#
# Prerequisites, which deploy.sh refuses to work around:
#   - a `zampsecret` version holding the database password
#   - the grants in iam.sh already applied
set -euo pipefail

PROJECT=project-cf6fd144-baf2-463b-9cd
REGION=asia-south1
REPO=asia-south1-docker.pkg.dev/${PROJECT}/zamp
# The pushed images are tagged v1, not latest. Override when you push a new one:
#   IMAGE_TAG=v2 ./deploy.sh
IMAGE_TAG=${IMAGE_TAG:-v1}

# Cloud SQL lives in us-central1 and the workers in asia-south1. The connector
# opens an mTLS tunnel by instance name, so the hop is a latency cost, not a
# networking problem — no VPC, no IP allowlist.
INSTANCE_CONNECTION_NAME=${PROJECT}:us-central1:free-trial-first-project
DB_NAME=ZampDB
DB_USER=${QUARRY_DB_USER:-zampuser}
DB_SECRET=zampsecret

BUCKET=zamptestbucket
TOPIC_UPLOADED=file-uploaded
TOPIC_CONVERT=convert-requested

SA_INSPECT=quarry-inspect-worker@${PROJECT}.iam.gserviceaccount.com
SA_CONVERT=quarry-convert-worker@${PROJECT}.iam.gserviceaccount.com
SA_PUBSUB=quarry-pubsub-invoker@${PROJECT}.iam.gserviceaccount.com
SA_SCHEDULER=quarry-scheduler-invoker@${PROJECT}.iam.gserviceaccount.com

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

# ------------------------------------------------------------------ guard
say "checking the database password is in Secret Manager"
if ! gcloud secrets versions describe latest --secret="$DB_SECRET" --project="$PROJECT" >/dev/null 2>&1; then
  echo "FATAL: secret '$DB_SECRET' has no version holding the database password." >&2
  echo "Add one first:" >&2
  echo "  printf %s '<password>' | gcloud secrets versions add $DB_SECRET --data-file=- --project=$PROJECT" >&2
  exit 1
fi

# --------------------------------------------------------------- services
#
# Sizing is §34, not invention. Both run at concurrency 1 — the processor is
# CPU-bound and holds a database connection per request — so max instances IS
# the parallelism of the whole system. The inspect worker gets more headroom
# because it runs on every upload, including files nobody ever converts; the
# convert worker is bounded lower because its work is long and, later,
# expensive. Both timeouts (900s) must exceed the 600s ack deadline, or a
# perfectly healthy worker has its message redelivered underneath it.
deploy_worker() {
  local name=$1 image=$2 role=$3 account=$4 memory=$5 max_instances=$6

  say "deploying $name ($role)"
  gcloud run deploy "$name" \
    --project="$PROJECT" \
    --region="$REGION" \
    --image="${REPO}/${image}:${IMAGE_TAG}" \
    --service-account="$account" \
    --add-cloudsql-instances="$INSTANCE_CONNECTION_NAME" \
    --set-secrets="DB_PASSWORD=${DB_SECRET}:latest" \
    --set-env-vars="^@^SERVICE_ROLE=${role}@INSTANCE_CONNECTION_NAME=${INSTANCE_CONNECTION_NAME}@DB_USER=${DB_USER}@DB_NAME=${DB_NAME}@STORAGE_BACKEND=gcs@GCS_BUCKET_NAME=${BUCKET}@GCP_PROJECT_ID=${PROJECT}@PUBSUB_TOPIC_FILE_UPLOADED=${TOPIC_UPLOADED}@PUBSUB_TOPIC_CONVERT_REQUESTED=${TOPIC_CONVERT}@PUBSUB_DELIVERY=push@LEASE_SECONDS=600@LOG_LEVEL=INFO" \
    --memory="$memory" \
    --cpu=1 \
    --timeout=900 \
    --concurrency=1 \
    --min-instances=0 \
    --max-instances="$max_instances" \
    --no-allow-unauthenticated \
    --quiet

  # /health only — process liveness. A probe on /readyz or /healthz touches
  # PostgreSQL, which turns a database blip into a restart loop (§34.1).
  gcloud run services update "$name" \
    --project="$PROJECT" --region="$REGION" --quiet >/dev/null \
    --startup-probe="httpGet.path=/health,initialDelaySeconds=0,periodSeconds=5,failureThreshold=12,timeoutSeconds=3" \
    --liveness-probe="httpGet.path=/health,periodSeconds=30,timeoutSeconds=3"
}

deploy_worker quarry-inspect-worker schema-detector inspect "$SA_INSPECT" 512Mi 5
deploy_worker quarry-convert-worker data-processor  convert "$SA_CONVERT" 1Gi   3

INSPECT_URL=$(gcloud run services describe quarry-inspect-worker --project="$PROJECT" --region="$REGION" --format='value(status.url)')
CONVERT_URL=$(gcloud run services describe quarry-convert-worker --project="$PROJECT" --region="$REGION" --format='value(status.url)')
echo "inspect: $INSPECT_URL"
echo "convert: $CONVERT_URL"

# ---------------------------------------------------------------- invoker
# Both services are --no-allow-unauthenticated. Pub/Sub and Scheduler reach
# them by minting an OIDC token as their own account, and nothing else can.
say "granting run.invoker"
for pair in "quarry-inspect-worker:$SA_PUBSUB" "quarry-convert-worker:$SA_PUBSUB" \
            "quarry-inspect-worker:$SA_SCHEDULER" "quarry-convert-worker:$SA_SCHEDULER"; do
  svc=${pair%%:*}; member=${pair#*:}
  gcloud run services add-iam-policy-binding "$svc" \
    --project="$PROJECT" --region="$REGION" \
    --member="serviceAccount:$member" --role=roles/run.invoker --quiet >/dev/null
  echo "  ok  $member -> $svc"
done

# ----------------------------------------------------------- subscriptions
# A push subscription, not pull: Cloud Run is only awake while it is handling
# a request, so the broker has to do the waking.
#
# ack deadline 600s — the maximum, matching LEASE_SECONDS and sitting below the
# 900s request timeout, so Pub/Sub never redelivers a message the worker is
# still legitimately working on (§31.2). Five attempts, then the dead-letter
# topic, so a poison message stops rather than looping forever.
push_subscription() {
  local name=$1 topic=$2 endpoint=$3 dlq=$4

  local verb=create
  gcloud pubsub subscriptions describe "$name" --project="$PROJECT" >/dev/null 2>&1 && verb=update

  local args=(
    --project="$PROJECT"
    --push-endpoint="$endpoint"
    --push-auth-service-account="$SA_PUBSUB"
    --ack-deadline=600
    --dead-letter-topic="$dlq"
    --max-delivery-attempts=5
  )
  [[ $verb == create ]] && args+=(--topic="$topic")

  say "$verb subscription $name"
  gcloud pubsub subscriptions "$verb" "$name" "${args[@]}" --quiet
}

push_subscription quarry-file-uploaded-push     "$TOPIC_UPLOADED" "${INSPECT_URL}/" file-uploaded-dlq
push_subscription quarry-convert-requested-push "$TOPIC_CONVERT"  "${CONVERT_URL}/" convert-requested-dlq

# ------------------------------------------------------------------ sweep
# Not optional (§24.3, §31.2). The only thing that recovers an outbox row whose
# inline publish failed, and the only thing that reclaims a lease from a worker
# that died mid-file. Without it, both wait for a coincidence.
say "sweep schedule"
sweep_job() {
  local svc=$1 url=$2 job="quarry-${svc}-sweep"
  local verb=create
  gcloud scheduler jobs describe "$job" --project="$PROJECT" --location="$REGION" >/dev/null 2>&1 && verb=update
  gcloud scheduler jobs "$verb" http "$job" \
    --project="$PROJECT" --location="$REGION" \
    --schedule="* * * * *" \
    --uri="${url}/internal/sweep" \
    --http-method=POST \
    --oidc-service-account-email="$SA_SCHEDULER" \
    --oidc-token-audience="$url" \
    --quiet
  echo "  ok  $job -> ${url}/internal/sweep"
}
sweep_job inspect "$INSPECT_URL"
sweep_job convert "$CONVERT_URL"

say "done"
