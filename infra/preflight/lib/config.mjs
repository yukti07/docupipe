import { execFileSync } from "node:child_process"
import { failure } from "./report.mjs"

/**
 * Where the settings come from, in order of preference:
 *
 *   1. --from-terraform   reads `terraform output -json` in infra/terraform
 *   2. the environment    the same names Vercel and Cloud Run use
 *
 * Nothing here reads a secret. The database password is fetched from Secret
 * Manager at the point it is needed, so it never lands in a shell history or
 * a CI log.
 */

function fromTerraform(dir) {
  let raw
  try {
    raw = execFileSync("terraform", ["output", "-json"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (error) {
    throw failure(
      `could not read terraform output from ${dir}`,
      "Run `terraform init && terraform apply` there first, or drop --from-terraform\n" +
        "and set the variables in the environment instead.",
    )
  }

  const out = JSON.parse(raw)
  const env = out.vercel_env?.value ?? {}

  return {
    projectId: env.GCP_PROJECT_ID,
    projectNumber: env.GCP_PROJECT_NUMBER,
    region: env.GCP_REGION,
    bucket: env.GCS_BUCKET_NAME,
    topicFileUploaded: env.PUBSUB_TOPIC_FILE_UPLOADED,
    topicConvertRequested: env.PUBSUB_TOPIC_CONVERT_REQUESTED,
    vercelServiceAccount: env.GCP_SERVICE_ACCOUNT_EMAIL,
    instanceConnectionName: env.INSTANCE_CONNECTION_NAME,
    dbName: env.DB_NAME,
    dbUser: env.DB_USER,
    inspectServiceUrl: out.inspect_service_url?.value,
    convertServiceUrl: out.convert_service_url?.value,
    dbPasswordSecret: out.db_password_secret?.value,
    sessionSecret: out.session_secret_id?.value,
    artifactRepo: out.worker_image_repository?.value,
  }
}

function fromEnv() {
  const e = process.env
  return {
    projectId: e.GCP_PROJECT_ID,
    projectNumber: e.GCP_PROJECT_NUMBER,
    region: e.GCP_REGION ?? "asia-south1",
    bucket: e.GCS_BUCKET_NAME,
    topicFileUploaded: e.PUBSUB_TOPIC_FILE_UPLOADED ?? "file-uploaded",
    topicConvertRequested: e.PUBSUB_TOPIC_CONVERT_REQUESTED ?? "convert-requested",
    vercelServiceAccount: e.GCP_SERVICE_ACCOUNT_EMAIL,
    inspectServiceAccount: e.GCP_INSPECT_SERVICE_ACCOUNT,
    convertServiceAccount: e.GCP_CONVERT_SERVICE_ACCOUNT,
    instanceConnectionName: e.INSTANCE_CONNECTION_NAME,
    dbName: e.DB_NAME,
    dbUser: e.DB_USER,
    dbPassword: e.DB_PASSWORD,
    dbPasswordSecret: e.DB_PASSWORD_SECRET,
    inspectServiceUrl: e.INSPECT_SERVICE_URL,
    convertServiceUrl: e.CONVERT_SERVICE_URL,
    expectedCorsOrigins: e.CORS_ORIGINS ? e.CORS_ORIGINS.split(",") : null,
  }
}

export function loadConfig(argv) {
  const base = argv.fromTerraform ? fromTerraform(argv.terraformDir) : {}
  const env = fromEnv()

  // Terraform wins where it has a value; the environment fills the rest, so
  // the two can be mixed without surprises.
  const cfg = { ...env, ...Object.fromEntries(Object.entries(base).filter(([, v]) => v)) }

  cfg.readOnly = argv.readOnly
  cfg.prefix = "_preflight"

  const missing = ["projectId"].filter((k) => !cfg[k])
  if (missing.length) {
    throw failure(
      `missing required settings: ${missing.join(", ")}`,
      "Set GCP_PROJECT_ID, or pass --from-terraform to read them from your\n" +
        "Terraform state.",
    )
  }

  return cfg
}

export function parseArgs(argv) {
  const args = {
    readOnly: false,
    fromTerraform: false,
    terraformDir: new URL("../../terraform", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    only: null,
    verbose: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === "--read-only") args.readOnly = true
    else if (a === "--from-terraform") args.fromTerraform = true
    else if (a === "--terraform-dir") args.terraformDir = argv[++i]
    else if (a === "--only") args.only = argv[++i].split(",").map((s) => s.trim())
    else if (a === "--verbose" || a === "-v") args.verbose = true
    else if (a === "--help" || a === "-h") args.help = true
  }

  return args
}

export const USAGE = `
Quarry — GCP preflight

Proves real connectivity and IAM against a deployed project. Detached from the
application: it imports none of its code and shares none of its state.

  node preflight.mjs [options]

  --from-terraform      read settings from \`terraform output\` (recommended)
  --terraform-dir DIR   where to run it (default: infra/terraform)
  --read-only           make no writes at all — skips the checks that prove
                        write access, which are the ones most worth having
  --only a,b,c          run only these groups:
                        identity, storage, sql, pubsub, run, secrets, scheduler
  -v, --verbose
  -h, --help

WHAT IT WRITES (unless --read-only)

  · one object under  gs://<bucket>/_preflight/   — deleted afterwards
  · one message on each Pub/Sub topic             — the worker acks it as an
                                                    unknown file and moves on
  · one table  _preflight_<timestamp>             — dropped afterwards

Authentication is Application Default Credentials:

  gcloud auth application-default login
`
