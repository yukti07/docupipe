#!/usr/bin/env bash
# Provision the GCP resources and IAM bindings both workers need.
#
# Dry run by default: prints every command without executing. Re-run with --apply to execute.
# Idempotent -- safe to re-run after a partial failure.
#
# Run from Cloud Shell (gcloud is pre-authenticated) or any shell with gcloud installed.
# The caller needs project Owner, or Editor plus Project IAM Admin, to create the bindings below.
set -euo pipefail

# Cloud SDK may otherwise select an unsupported system Python on Windows.
# Prefer an explicit Python 3.12 executable for every gcloud invocation.
if [[ -z "${CLOUDSDK_PYTHON:-}" ]]; then
  if command -v python3.12 >/dev/null 2>&1; then
    CLOUDSDK_PYTHON="$(command -v python3.12)"
  elif command -v py.exe >/dev/null 2>&1; then
    CLOUDSDK_PYTHON="$(py.exe -3.12 -c 'import sys; print(sys.executable)' | tr -d '\r')"
  elif command -v py >/dev/null 2>&1; then
    CLOUDSDK_PYTHON="$(py -3.12 -c 'import sys; print(sys.executable)' | tr -d '\r')"
  else
    echo "ERROR: Python 3.12 is required. Install it or set CLOUDSDK_PYTHON." >&2
    exit 1
  fi
fi
GCLOUD_LAUNCHER="$(command -v gcloud 2>/dev/null || true)"
USE_WINDOWS_GCLOUD=0
if command -v cmd.exe >/dev/null 2>&1 && [[ "$GCLOUD_LAUNCHER" == /mnt/* ]]; then
  USE_WINDOWS_GCLOUD=1
  gcloud() { cmd.exe /c gcloud.cmd "$@"; }
fi
# Git Bash uses the MSYS path form when launching the Unix gcloud wrapper.
if (( ! USE_WINDOWS_GCLOUD )); then
  case "$CLOUDSDK_PYTHON" in
    [A-Za-z]:\\*|[A-Za-z]:/*)
      python_drive="${CLOUDSDK_PYTHON:0:1}"
      python_path="${CLOUDSDK_PYTHON:2}"
      python_path="${python_path//\\//}"
      python_path="${python_path#/}"
      if [[ -d "/mnt/${python_drive,,}" ]]; then
        CLOUDSDK_PYTHON="/mnt/${python_drive,,}/${python_path}"
      else
        CLOUDSDK_PYTHON="/${python_drive,,}/${python_path}"
      fi
      ;;
  esac
fi
export CLOUDSDK_PYTHON

PROJECT_ID="${PROJECT_ID:-project-cf6fd144-baf2-463b-9cd}"
REGION="${REGION:-us-central1}"
REPOSITORY="${REPOSITORY:-zamp}"
BUCKET="${BUCKET:-zamptestbucket}"
SQL_REGION="${SQL_REGION:-us-central1}"
SQL_INSTANCE="${SQL_INSTANCE:-free-trial-first-project}"
SQL_TIER="${SQL_TIER:-db-f1-micro}"
SQL_MODE="${SQL_MODE:-existing}"   # create | existing
DB_NAME="${DB_NAME:-ZampDB}"
DB_USER="${DB_USER:-zampuser}" #password:Zamp@123
SECRET_NAME="${SECRET_NAME:-zamp-database-url}"
TAG="${TAG:-}"
APPLY=0

usage() {
  cat <<'EOF'
Usage: PROJECT_ID=my-project BUCKET=my-bucket ./scripts/setup_gcp.sh [--apply]

Required: PROJECT_ID, BUCKET
Optional: REGION (us-central1) REPOSITORY (zamp) SQL_INSTANCE (free-trial-first-project)
          SQL_TIER (db-f1-micro) DB_NAME (ZampDB) DB_USER (zampuser)
          SECRET_NAME (zamp-database-url) TAG (git short sha, else timestamp)
          SQL_MODE (existing) -- set to 'create' only for a new Cloud SQL instance;
            'existing' uses the Cloud SQL instance you
            already have. The instance and database are then verified rather than
            created, and you are prompted for the DB user's password at runtime.

Creates: APIs, Artifact Registry repo, GCS bucket, 4 service accounts, Cloud SQL Postgres,
         Secret Manager secret, 2 Cloud Run services, 3 Pub/Sub topics, 2 push subscriptions,
         and all IAM bindings.
EOF
}

[[ "${1:-}" == "--help" || "${1:-}" == "-h" ]] && { usage; exit 0; }
[[ "${1:-}" == "--apply" ]] && APPLY=1
[[ -z "$PROJECT_ID" || -z "$BUCKET" ]] && { usage; echo; echo "ERROR: PROJECT_ID and BUCKET are required." >&2; exit 1; }
command -v gcloud >/dev/null || { echo "ERROR: gcloud is not on PATH." >&2; exit 1; }

if [[ -z "$TAG" ]]; then
  TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d-%H%M%S)"
fi

SOURCE_DIR="$(pwd)"
if command -v wslpath >/dev/null 2>&1; then
  SOURCE_DIR="$(wslpath -w "$SOURCE_DIR")"
fi

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
run() {
  # Re-quote for printing so dry-run output stays copy-pasteable.
  local line="" arg
  for arg in "$@"; do
    case "$arg" in
      *\'*)                  line+=" $(printf '%q' "$arg")" ;;
      *[[:space:]\>\<\|\&]*) line+=" '${arg}'" ;;
      *)                     line+=" ${arg}" ;;
    esac
  done
  printf ' %s\n' "$line"
  if (( APPLY )); then "$@"; fi
}
# Create only when absent, so re-runs are quiet instead of erroring.
ensure() {
  local description="$1" probe="$2"; shift 2
  if (( APPLY )) && eval "$probe" >/dev/null 2>&1; then
    printf '  [exists] %s\n' "$description"
  else
    run "$@"
  fi
}

DETECTOR_SA="quarry-inspect-worker@${PROJECT_ID}.iam.gserviceaccount.com"
PROCESSOR_SA="quarry-convert-worker@${PROJECT_ID}.iam.gserviceaccount.com"
PUSH_SCHEMA_SA="quarry-pubsub-invoker@${PROJECT_ID}.iam.gserviceaccount.com"
PUSH_PROCESSING_SA="quarry-pubsub-invoker@${PROJECT_ID}.iam.gserviceaccount.com"
SQL_CONNECTION="${PROJECT_ID}:${SQL_REGION}:${SQL_INSTANCE}"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}"

if (( APPLY )); then
  echo "APPLYING to project ${PROJECT_ID} (region ${REGION}, tag ${TAG})"
else
  echo "DRY RUN -- printing commands only. Re-run with --apply to execute."
  echo "Target: project ${PROJECT_ID}, region ${REGION}, tag ${TAG}"
fi

step "1. Enable APIs"
run gcloud services enable \
  run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  pubsub.googleapis.com storage.googleapis.com secretmanager.googleapis.com \
  sqladmin.googleapis.com iamcredentials.googleapis.com --project="$PROJECT_ID"

step "2. Artifact Registry and GCS bucket"
ensure "repository ${REPOSITORY}" \
  "gcloud artifacts repositories describe '$REPOSITORY' --location='$REGION' --project='$PROJECT_ID'" \
  gcloud artifacts repositories create "$REPOSITORY" --repository-format=docker \
    --location="$REGION" --project="$PROJECT_ID" --description="Zamp worker images"
ensure "bucket ${BUCKET}" \
  "gcloud storage buckets describe 'gs://$BUCKET' --project='$PROJECT_ID'" \
  gcloud storage buckets create "gs://${BUCKET}" --location="$REGION" \
    --uniform-bucket-level-access --project="$PROJECT_ID"

step "3. Service accounts"
# Two runtime identities (one per worker) and two push identities (one per subscription),
# so an invoker grant can never reach the service it is not meant to call.
for entry in \
  "quarry-inspect-worker:Schema detector runtime" \
  "quarry-convert-worker:Data processor runtime" \
  "quarry-pubsub-invoker:Pub/Sub push -> both workers"; do
  account="${entry%%:*}"; display="${entry#*:}"
  ensure "service account ${account}" \
    "gcloud iam service-accounts describe '${account}@${PROJECT_ID}.iam.gserviceaccount.com' --project='$PROJECT_ID'" \
    gcloud iam service-accounts create "$account" --display-name="$display" --project="$PROJECT_ID"
done

step "4. Cloud SQL instance and database"
if [[ "$SQL_MODE" == "existing" ]]; then
  echo "  SQL_MODE=existing -- verifying rather than creating"
  if (( APPLY )); then
    gcloud sql instances describe "$SQL_INSTANCE" --project="$PROJECT_ID" >/dev/null 2>&1 \
      || { echo "ERROR: Cloud SQL instance '${SQL_INSTANCE}' not found in ${PROJECT_ID}." >&2; exit 1; }
    echo "  [verified] instance ${SQL_INSTANCE}"
    gcloud sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE" --project="$PROJECT_ID" >/dev/null 2>&1 \
      || { echo "ERROR: database '${DB_NAME}' not found on '${SQL_INSTANCE}'." >&2; exit 1; }
    echo "  [verified] database ${DB_NAME}"
  else
    echo "  gcloud sql instances describe ${SQL_INSTANCE} --project=${PROJECT_ID}    # verify only"
    echo "  gcloud sql databases describe ${DB_NAME} --instance=${SQL_INSTANCE}      # verify only"
  fi
else
  ensure "instance ${SQL_INSTANCE}" \
    "gcloud sql instances describe '$SQL_INSTANCE' --project='$PROJECT_ID'" \
    gcloud sql instances create "$SQL_INSTANCE" --database-version=POSTGRES_16 \
      --tier="$SQL_TIER" --region="$REGION" --project="$PROJECT_ID"
  ensure "database ${DB_NAME}" \
    "gcloud sql databases describe '$DB_NAME' --instance='$SQL_INSTANCE' --project='$PROJECT_ID'" \
    gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE" --project="$PROJECT_ID"
fi

step "5. Database credentials and connection secret"
if (( APPLY )); then
  if gcloud secrets describe "$SECRET_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "  [exists] secret ${SECRET_NAME} -- leaving the stored value untouched"
  else
    if [[ "$SQL_MODE" == "existing" ]]; then
      # Read from the terminal, never an argument or env var, so the password stays out of
      # shell history, the process table, and this repo.
      read -rsp "  Password for existing database user '${DB_USER}': " DB_PASSWORD < /dev/tty; echo
      [[ -z "$DB_PASSWORD" ]] && { echo "ERROR: empty password." >&2; exit 1; }
    else
      DB_PASSWORD="$($CLOUDSDK_PYTHON -c 'import secrets; print(secrets.token_urlsafe(32))')"
      gcloud sql users create "$DB_USER" --instance="$SQL_INSTANCE" \
        --password="$DB_PASSWORD" --project="$PROJECT_ID" 2>/dev/null \
        || gcloud sql users set-password "$DB_USER" --instance="$SQL_INSTANCE" \
             --password="$DB_PASSWORD" --project="$PROJECT_ID"
    fi
    # Unix-socket DSN: Cloud Run mounts the instance at /cloudsql/<connection name>.
    printf 'postgresql+psycopg://%s:%s@/%s?host=/cloudsql/%s' \
      "$DB_USER" "$DB_PASSWORD" "$DB_NAME" "$SQL_CONNECTION" \
      | gcloud secrets create "$SECRET_NAME" --data-file=- --replication-policy=automatic --project="$PROJECT_ID"
    unset DB_PASSWORD
    echo "  created secret ${SECRET_NAME}"
  fi
else
  if [[ "$SQL_MODE" == "existing" ]]; then
    echo "  read -rsp 'Password for existing database user ${DB_USER}: '   # prompted at apply time"
  else
    echo "  gcloud sql users create ${DB_USER} --instance=${SQL_INSTANCE} --password=<generated>"
  fi
  echo "  printf 'postgresql+psycopg://${DB_USER}:<password>@/${DB_NAME}?host=/cloudsql/${SQL_CONNECTION}' \\"
  echo "    | gcloud secrets create ${SECRET_NAME} --data-file=- --replication-policy=automatic"
fi

step "6. Runtime service account permissions"
# storage.objectUser (not objectCreator) because the retry path re-uploads the same object key,
# and overwriting an existing object requires delete as well as create.
for sa in "$DETECTOR_SA" "$PROCESSOR_SA"; do
  run gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
    --member="serviceAccount:${sa}" --role=roles/storage.objectUser --project="$PROJECT_ID"
  run gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
    --member="serviceAccount:${sa}" --role=roles/secretmanager.secretAccessor --project="$PROJECT_ID"
  for role in roles/cloudsql.client roles/logging.logWriter; do
    run gcloud projects add-iam-policy-binding "$PROJECT_ID" \
      --member="serviceAccount:${sa}" --role="$role" --condition=None
  done
done

step "7. Build images"
run gcloud builds submit --config=cloudbuild.yaml \
  --substitutions="_TAG=${TAG},_REGION=${REGION},_REPOSITORY=${REPOSITORY}" \
  --project="$PROJECT_ID" "$SOURCE_DIR"

step "8. Deploy Cloud Run services"
# min/max instances and concurrency follow the POC settings in README.md.
# timeout=600 matches the maximum Pub/Sub push ack deadline set in step 11.
run gcloud run deploy zamp-schema-detector \
  --image="${REGISTRY}/schema-detector:${TAG}" --region="$REGION" --project="$PROJECT_ID" \
  --service-account="$DETECTOR_SA" --no-allow-unauthenticated \
  --set-secrets="ZAMP_DATABASE_URL=${SECRET_NAME}:latest" \
  --set-env-vars="ZAMP_GCP_PROJECT_ID=${PROJECT_ID},ZAMP_GCP_STORAGE_BUCKET=${BUCKET}" \
  --add-cloudsql-instances="$SQL_CONNECTION" \
  --min-instances=0 --max-instances=1 --concurrency=1 --timeout=600
run gcloud run deploy zamp-data-processor \
  --image="${REGISTRY}/data-processor:${TAG}" --region="$REGION" --project="$PROJECT_ID" \
  --service-account="$PROCESSOR_SA" --no-allow-unauthenticated \
  --set-secrets="ZAMP_DATABASE_URL=${SECRET_NAME}:latest" \
  --set-env-vars="ZAMP_GCP_PROJECT_ID=${PROJECT_ID},ZAMP_GCP_STORAGE_BUCKET=${BUCKET}" \
  --add-cloudsql-instances="$SQL_CONNECTION" \
  --min-instances=0 --max-instances=1 --concurrency=1 --timeout=600

step "9. Scope each push identity to exactly one service"
run gcloud run services add-iam-policy-binding zamp-schema-detector --region="$REGION" --project="$PROJECT_ID" \
  --member="serviceAccount:${PUSH_SCHEMA_SA}" --role=roles/run.invoker
run gcloud run services add-iam-policy-binding zamp-data-processor --region="$REGION" --project="$PROJECT_ID" \
  --member="serviceAccount:${PUSH_PROCESSING_SA}" --role=roles/run.invoker

step "10. Let the Pub/Sub service agent mint OIDC tokens"
# Without this the push subscriptions cannot sign as the push identities and every delivery 403s.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)' 2>/dev/null || echo '<PROJECT_NUMBER>')"
PUBSUB_AGENT="service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"
echo "  Using Pub/Sub service agent ${PUBSUB_AGENT}"
for sa in "$PUSH_SCHEMA_SA" "$PUSH_PROCESSING_SA"; do
  run gcloud iam service-accounts add-iam-policy-binding "$sa" \
    --member="serviceAccount:${PUBSUB_AGENT}" --role=roles/iam.serviceAccountTokenCreator --project="$PROJECT_ID"
done

step "11. Topics, dead-letter topic, and push subscriptions"
for topic in file-uploaded convert-requested file-uploaded-dlq convert-requested-dlq; do
  ensure "topic ${topic}" \
    "gcloud pubsub topics describe '$topic' --project='$PROJECT_ID'" \
    gcloud pubsub topics create "$topic" --project="$PROJECT_ID"
done

if (( APPLY )); then
  DETECTOR_URL="$(gcloud run services describe zamp-schema-detector --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)')"
  PROCESSOR_URL="$(gcloud run services describe zamp-data-processor --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)')"
else
  DETECTOR_URL="https://zamp-schema-detector-<hash>.${REGION}.run.app"
  PROCESSOR_URL="https://zamp-data-processor-<hash>.${REGION}.run.app"
fi

# max-delivery-attempts bounds the poison-message retry loop; see docs/worker_review_findings.md A4.
ensure "subscription quarry-file-uploaded-push" \
  "gcloud pubsub subscriptions describe quarry-file-uploaded-push --project='$PROJECT_ID'" \
  gcloud pubsub subscriptions create quarry-file-uploaded-push --project="$PROJECT_ID" \
    --topic=file-uploaded --push-endpoint="${DETECTOR_URL}/" \
    --push-auth-service-account="$PUSH_SCHEMA_SA" --ack-deadline=600 \
    --dead-letter-topic=file-uploaded-dlq --max-delivery-attempts=5
ensure "subscription quarry-convert-requested-push" \
  "gcloud pubsub subscriptions describe quarry-convert-requested-push --project='$PROJECT_ID'" \
  gcloud pubsub subscriptions create quarry-convert-requested-push --project="$PROJECT_ID" \
    --topic=convert-requested --push-endpoint="${PROCESSOR_URL}/" \
    --push-auth-service-account="$PUSH_PROCESSING_SA" --ack-deadline=600 \
    --dead-letter-topic=convert-requested-dlq --max-delivery-attempts=5

if (( APPLY )); then
  gcloud pubsub subscriptions update quarry-file-uploaded-push --project="$PROJECT_ID" \
    --push-endpoint="${DETECTOR_URL}/" --push-auth-service-account="$PUSH_SCHEMA_SA"
  gcloud pubsub subscriptions update quarry-convert-requested-push --project="$PROJECT_ID" \
    --push-endpoint="${PROCESSOR_URL}/" --push-auth-service-account="$PUSH_PROCESSING_SA"
fi

if (( APPLY )); then
  gcloud pubsub subscriptions update quarry-file-uploaded-push --project="$PROJECT_ID" --push-endpoint="${DETECTOR_URL}/"
  gcloud pubsub subscriptions update quarry-convert-requested-push --project="$PROJECT_ID" --push-endpoint="${PROCESSOR_URL}/"
fi

step "12. Dead-letter permissions for the Pub/Sub service agent"
for topic in file-uploaded-dlq convert-requested-dlq; do
  run gcloud pubsub topics add-iam-policy-binding "$topic" \
    --member="serviceAccount:${PUBSUB_AGENT}" --role=roles/pubsub.publisher --project="$PROJECT_ID"
done
for subscription in quarry-file-uploaded-push quarry-convert-requested-push; do
  run gcloud pubsub subscriptions add-iam-policy-binding "$subscription" \
    --member="serviceAccount:${PUBSUB_AGENT}" --role=roles/pubsub.subscriber --project="$PROJECT_ID"
done

cat <<EOF

$( (( APPLY )) && echo "Done." || echo "Dry run complete -- nothing was created." )

Still manual:

  1. Create the database tables. Nothing in this repo runs migrations, and the workers do not
     create tables at startup. Apply the DDL in docs/worker_missing_tables.md plus the backend's
     own tables:
       gcloud sql connect ${SQL_INSTANCE} --user=${DB_USER} --database=${DB_NAME} --project=${PROJECT_ID}

  2. Grant whoever publishes the events roles/pubsub.publisher on both topics:
       gcloud pubsub topics add-iam-policy-binding file-uploaded \\
         --member="serviceAccount:<backend-sa>" --role=roles/pubsub.publisher --project=${PROJECT_ID}
       gcloud pubsub topics add-iam-policy-binding convert-requested \\
         --member="serviceAccount:<backend-sa>" --role=roles/pubsub.publisher --project=${PROJECT_ID}

  3. Verify. Both services reject unauthenticated calls, so mint a token:
       curl -H "Authorization: Bearer \$(gcloud auth print-identity-token)" ${DETECTOR_URL}/health
     That needs roles/run.invoker for your own account; grant it temporarily if the call 403s.

Notes:

  - cloudbuild.yaml uses the user-defined \${_TAG} substitution so manual builds and deployments use
    the same immutable image tag.
  - On projects created after April 2024, Cloud Build runs as the Compute Engine default service
    account and may need roles/artifactregistry.writer and roles/logging.logWriter granted explicitly,
    or a dedicated build service account passed with --service-account.
EOF
