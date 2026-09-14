import "server-only"

import { Pool, type PoolClient } from "pg"

import { env } from "../env"

/**
 * The connection pool.
 *
 * Deployed, this goes through `@google-cloud/cloud-sql-connector` — the Cloud
 * SQL Auth Proxy compiled into the process. The proxy BINARY cannot run on a
 * serverless platform, so the library is the supported equivalent: same IAM
 * check, same ephemeral mTLS certificates, no open ports and no IP allowlist.
 *
 * Locally, a plain DATABASE_URL (docker compose, or `cloud-sql-proxy`).
 *
 * Prisma still owns the schema and the migrations (packages/db). This side
 * reads and writes with SQL and never migrates — the same division the Python
 * worker follows.
 */

let pool: Pool | null = null
let connecting: Promise<Pool> | null = null

async function create(): Promise<Pool> {
  const cfg = env()

  if (cfg.databaseUrl) {
    return new Pool({
      connectionString: cfg.databaseUrl,
      max: cfg.dbPoolMax,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    })
  }

  if (!cfg.instanceConnectionName) {
    throw new Error(
      "No database configured. Set DATABASE_URL, or INSTANCE_CONNECTION_NAME " +
        "with DB_USER / DB_PASSWORD / DB_NAME.",
    )
  }

  // Imported lazily: constructing a connector resolves credentials, and doing
  // that at module scope fails `next build`, where there is no OIDC token.
  const { Connector, IpAddressTypes } = await import("@google-cloud/cloud-sql-connector")
  const connector = new Connector()
  const clientOpts = await connector.getOptions({
    instanceConnectionName: cfg.instanceConnectionName,
    ipType: IpAddressTypes.PUBLIC,
  })

  return new Pool({
    ...clientOpts,
    user: cfg.dbUser,
    password: cfg.dbPassword,
    database: cfg.dbName,
    max: cfg.dbPoolMax,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  })
}

export async function getPool(): Promise<Pool> {
  if (pool) return pool
  // Two concurrent first requests must not each build a pool.
  connecting ??= create().then((created) => {
    pool = created
    connecting = null
    return created
  })
  return connecting
}

export async function query<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const p = await getPool()
  const result = await p.query(sql, params)
  return result.rows as T[]
}

export async function queryOne<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params)
  return rows[0] ?? null
}

/**
 * One unit of work.
 *
 * Everything that must agree happens inside one of these — in particular a
 * state change and the outbox row that announces it. That is the whole point
 * of the outbox: a job that is durably created but not durably queued is the
 * failure it exists to prevent.
 */
export async function transaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const p = await getPool()
  const client = await p.connect()
  try {
    await client.query("BEGIN")
    const result = await fn(client)
    await client.query("COMMIT")
    return result
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      /* the connection is already broken; the original error is the useful one */
    })
    throw error
  } finally {
    client.release()
  }
}

export async function healthCheck(): Promise<boolean> {
  try {
    await query("SELECT 1")
    return true
  } catch {
    return false
  }
}

/** Tests inject their own pool. */
export function setPool(next: Pool | null): void {
  pool = next
  connecting = null
}
