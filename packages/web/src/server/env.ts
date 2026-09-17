import "server-only"

/**
 * Configuration, read once and validated on first use.
 *
 * Nothing here is read at module scope on purpose: during `next build` there is
 * no OIDC token and no database, and a module that resolves credentials at
 * import time fails the build with an error that names credentials rather than
 * timing.
 */

export type StorageBackend = "gcs" | "local"

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set. The server refuses to start rather than failing on ` +
        `the first request that needs it.`,
    )
  }
  return value
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback
}

function int(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed)) throw new Error(`${name} must be an integer, got ${raw}`)
  return parsed
}

let cached: Env | null = null

export type Env = ReturnType<typeof build>

function build() {
  const storageBackend = (optional("STORAGE_BACKEND", "gcs") as StorageBackend) satisfies
    | "gcs"
    | "local"

  if (storageBackend !== "gcs" && storageBackend !== "local") {
    throw new Error(`STORAGE_BACKEND must be "gcs" or "local", got ${storageBackend}`)
  }

  const isProduction = process.env.NODE_ENV === "production"
  const allowDevUser = optional("ALLOW_DEV_USER") === "true"

  // A flag that disables authorization has to fail loudly, because its failure
  // mode is invisible: everything works, for everyone, on everyone's data.
  if (allowDevUser && isProduction) {
    throw new Error(
      "ALLOW_DEV_USER is set in production. It bypasses the session cookie and " +
        "must never be enabled in a deployed environment.",
    )
  }

  return {
    isProduction,
    storageBackend,

    /* session */
    sessionSecret: isProduction ? required("SESSION_SECRET") : optional("SESSION_SECRET", "dev-only-insecure-secret"),
    allowDevUser,
    devUserId: optional("DEV_USER_ID"),

    /* database */
    databaseUrl: optional("DATABASE_URL"),
    instanceConnectionName: optional("INSTANCE_CONNECTION_NAME"),
    dbUser: optional("DB_USER"),
    dbPassword: optional("DB_PASSWORD"),
    dbName: optional("DB_NAME"),
    // Every warm function instance holds its own pool and concurrency is not
    // shared between them, so this stays small. Raising it is the wrong fix
    // for connection exhaustion.
    dbPoolMax: int("DB_POOL_MAX", 2),

    /* storage */
    bucket: optional("GCS_BUCKET_NAME"),
    localStorageRoot: optional("LOCAL_STORAGE_ROOT", ".local-storage"),
    signedUrlTtlMs: int("SIGNED_URL_TTL_MS", 15 * 60 * 1000),
    maxUploadBytes: int("MAX_UPLOAD_BYTES", 50 * 1024 * 1024),
    maxFilesPerRequest: int("MAX_FILES_PER_REQUEST", 500),

    /* pub/sub */
    projectId: optional("GCP_PROJECT_ID"),
    topicFileUploaded: optional("PUBSUB_TOPIC_FILE_UPLOADED", "file-uploaded"),
    topicConvertRequested: optional("PUBSUB_TOPIC_CONVERT_REQUESTED", "convert-requested"),
    // Local only: where the API hands a message straight to the worker,
    // because there is no broker in `docker compose`.
    workerUrl: optional("WORKER_URL", "http://localhost:8080"),

    /* google credentials, deployed. All four or none — see server/gcp-auth.ts */
    projectNumber: optional("GCP_PROJECT_NUMBER"),
    serviceAccountEmail: optional("GCP_SERVICE_ACCOUNT_EMAIL"),
    workloadIdentityPoolId: optional("GCP_WORKLOAD_IDENTITY_POOL_ID"),
    workloadIdentityProviderId: optional("GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID"),

    /* allowance */
    defaultDailyLimit: int("DEFAULT_DAILY_LIMIT", 5000),
  }
}

export function env(): Env {
  if (cached === null) cached = build()
  return cached
}

/** Tests change the environment between cases. */
export function resetEnv(): void {
  cached = null
}
