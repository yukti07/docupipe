import { Connector, IpAddressTypes } from "@google-cloud/cloud-sql-connector"
import pg from "pg"
import { failure } from "../report.mjs"

/**
 * Cloud SQL, through the same transport the deployed API uses.
 *
 * `@google-cloud/cloud-sql-connector` is the Auth Proxy compiled into the
 * process — the proxy BINARY cannot run on a serverless platform, so this is
 * the supported equivalent and the thing actually worth testing.
 *
 * The write checks are the point. "Can connect" proves very little: the app
 * needs to CREATE TYPE and CREATE TABLE for migrations, and INSERT / UPDATE /
 * DELETE at runtime, and those are separate grants that fail separately.
 */

const { Pool } = pg

export async function run(report, cfg, state) {
  report.group("Cloud SQL")

  if (!cfg.instanceConnectionName) {
    report.skip("connection", "INSTANCE_CONNECTION_NAME is not set (pass --from-terraform)")
    return
  }

  let password = cfg.dbPassword

  await report.check("fetch the database password from Secret Manager", async () => {
    if (password) return { detail: "taken from DB_PASSWORD" }
    if (!cfg.dbPasswordSecret) {
      throw failure(
        "no password and no secret name",
        "Set DB_PASSWORD, or DB_PASSWORD_SECRET, or pass --from-terraform.",
      )
    }

    const { SecretManagerServiceClient } = await import("@google-cloud/secret-manager")
    const client = new SecretManagerServiceClient()
    const name = `projects/${cfg.projectId}/secrets/${cfg.dbPasswordSecret}/versions/latest`
    const [version] = await client.accessSecretVersion({ name })
    password = version.payload.data.toString()

    // Never printed, never logged, never returned as detail.
    return { detail: `read ${cfg.dbPasswordSecret} (value not shown)` }
  }, {
    fix: "Grant roles/secretmanager.secretAccessor on the secret to whoever runs this.",
  })

  if (!password) {
    report.skip("everything below", "no database password")
    return
  }

  let connector
  let pool

  await report.check("connect through the Cloud SQL connector", async () => {
    connector = new Connector()
    const clientOpts = await connector.getOptions({
      instanceConnectionName: cfg.instanceConnectionName,
      ipType: IpAddressTypes.PUBLIC,
    })

    pool = new Pool({
      ...clientOpts,
      user: cfg.dbUser,
      password,
      database: cfg.dbName,
      max: 2,
      connectionTimeoutMillis: 15_000,
    })

    const { rows } = await pool.query("SELECT version(), current_user, current_database()")
    state.sqlPool = pool
    state.sqlConnector = connector

    return {
      detail:
        `${rows[0].version.split(" ").slice(0, 2).join(" ")} · ` +
        `as ${rows[0].current_user} on ${rows[0].current_database}`,
    }
  }, {
    fix:
      "Check roles/cloudsql.client on the caller, that the instance has a public IP,\n" +
      "and that DB_USER / DB_NAME are right. Authorized networks should be EMPTY —\n" +
      "the connector authenticates with a certificate, not an IP.",
  })

  if (!pool) return

  await report.check("the app user is NOT a superuser", async () => {
    const { rows } = await pool.query(
      "SELECT rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user",
    )
    const role = rows[0] ?? {}
    if (role.rolsuper) {
      throw failure(
        "it is a superuser",
        "Application code should never run as a superuser. Create a least-privilege\n" +
          "role and point DB_USER at it.",
      )
    }
    const extra = [
      role.rolcreaterole ? "CREATEROLE" : null,
      role.rolcreatedb ? "CREATEDB" : null,
    ].filter(Boolean)
    if (extra.length) return { warn: `has ${extra.join(" and ")}, which it does not need` }
    return { detail: "least privilege" }
  })

  await report.check("connection headroom", async () => {
    const { rows } = await pool.query(`
      SELECT (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max,
             (SELECT count(*)::int FROM pg_stat_activity)                          AS used
    `)
    const { max, used } = rows[0]
    const pct = Math.round((used / max) * 100)
    if (pct > 70) {
      return {
        warn:
          `${used} of ${max} connections in use (${pct}%). Bound the pools rather ` +
          `than raising the ceiling — every warm instance holds its own.`,
      }
    }
    return { detail: `${used} of ${max} in use` }
  })

  if (cfg.readOnly) {
    report.skip("CREATE TABLE / INSERT / UPDATE / DELETE", "--read-only")
  } else {
    await runWriteChecks(report, pool)
  }

  await report.check("the application schema is present", async () => {
    const expected = [
      "users",
      "requests",
      "files",
      "file_schemas",
      "file_schema_results",
      "file_events",
      "request_outbox",
      "user_allowance",
    ]
    const { rows } = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    )
    const found = new Set(rows.map((r) => r.tablename))
    const missing = expected.filter((t) => !found.has(t))

    if (missing.length === expected.length) {
      return { warn: "no application tables — migrations have not been run yet" }
    }
    if (missing.length) {
      throw failure(
        `missing: ${missing.join(", ")}`,
        "Run `npx prisma migrate deploy` from packages/db against this database.",
      )
    }
    return { detail: `${expected.length} tables` }
  })

  await report.check("the failure_class enum matches the application", async () => {
    const { rows } = await pool.query(
      `SELECT e.enumlabel FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'failure_class'`,
    )
    if (rows.length === 0) return { warn: "enum not present — migrations not run" }
    // A mismatch here means a write will fail at runtime with a constraint
    // error rather than anything a user could act on.
    const required = ["acquisition", "empty_file", "format_corrupt", "internal"]
    const found = new Set(rows.map((r) => r.enumlabel))
    const missing = required.filter((v) => !found.has(v))
    if (missing.length) {
      throw failure(
        `enum is missing ${missing.join(", ")}`,
        "The database enum has drifted from failures.py / types.ts. Re-run migrations.",
      )
    }
    return { detail: `${rows.length} classes` }
  })

  await report.check("close the pool", async () => {
    await pool.end()
    connector.close()
    state.sqlPool = null
    return { detail: "clean" }
  })
}

/**
 * The permissions that matter, checked by using them.
 *
 * Everything is namespaced and dropped afterwards, and the whole thing runs in
 * ONE transaction that is rolled back if anything raises — so a failure
 * halfway through leaves nothing behind.
 */
async function runWriteChecks(report, pool) {
  const table = `_preflight_${Date.now()}`
  const enumName = `${table}_kind`
  let client

  await report.check("CREATE TABLE (migrations need this)", async () => {
    client = await pool.connect()
    await client.query("BEGIN")
    await client.query(
      `CREATE TABLE ${table} (
         id      TEXT PRIMARY KEY,
         n       INTEGER NOT NULL DEFAULT 0,
         payload JSONB,
         made_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    )
    return { detail: table }
  }, {
    fix: "GRANT CREATE ON SCHEMA public TO <app user>;",
  })

  await report.check("CREATE TYPE (the schema uses enums)", async () => {
    if (!client) return { skip: "no table" }
    await client.query(`CREATE TYPE ${enumName} AS ENUM ('a','b')`)
    return { detail: enumName }
  })

  await report.check("INSERT", async () => {
    if (!client) return { skip: "no table" }
    await client.query(
      `INSERT INTO ${table} (id, n, payload) VALUES ($1, $2, $3::jsonb)`,
      ["row-1", 1, JSON.stringify({ preflight: true })],
    )
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table}`)
    if (rows[0].n !== 1) throw new Error("row did not land")
    return { detail: "1 row" }
  }, {
    fix: "GRANT INSERT ON ALL TABLES IN SCHEMA public TO <app user>;",
  })

  await report.check("SELECT with a jsonb read", async () => {
    if (!client) return { skip: "no table" }
    const { rows } = await client.query(
      `SELECT id, payload->>'preflight' AS flag FROM ${table} WHERE id = $1`,
      ["row-1"],
    )
    if (rows[0]?.flag !== "true") throw new Error("jsonb did not round trip")
    return { detail: "jsonb round trips" }
  })

  await report.check("UPDATE", async () => {
    if (!client) return { skip: "no table" }
    const { rowCount } = await client.query(
      `UPDATE ${table} SET n = n + 1 WHERE id = $1`,
      ["row-1"],
    )
    if (rowCount !== 1) throw new Error("no row updated")
    return { detail: "1 row" }
  })

  await report.check("transaction rollback works", async () => {
    if (!client) return { skip: "no table" }
    await client.query("SAVEPOINT sp")
    await client.query(`INSERT INTO ${table} (id) VALUES ('rolled-back')`)
    await client.query("ROLLBACK TO SAVEPOINT sp")
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE id = 'rolled-back'`,
    )
    if (rows[0].n !== 0) throw new Error("rollback did not undo the insert")
    return { detail: "the outbox depends on this" }
  })

  await report.check("SELECT ... FOR UPDATE SKIP LOCKED", async () => {
    if (!client) return { skip: "no table" }
    // The outbox relay's claim. It is a real capability, not just syntax.
    await client.query(
      `SELECT id FROM ${table} ORDER BY made_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
    )
    return { detail: "the relay's claim query is permitted" }
  })

  await report.check("DELETE", async () => {
    if (!client) return { skip: "no table" }
    const { rowCount } = await client.query(`DELETE FROM ${table} WHERE id = $1`, ["row-1"])
    if (rowCount !== 1) throw new Error("no row deleted")
    return { detail: "1 row" }
  })

  await report.check("clean up (DROP TABLE and TYPE)", async () => {
    if (!client) return { skip: "nothing to clean" }
    try {
      await client.query(`DROP TABLE IF EXISTS ${table}`)
      await client.query(`DROP TYPE IF EXISTS ${enumName}`)
      await client.query("COMMIT")
      return { detail: "nothing left behind" }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {})
      throw error
    } finally {
      client.release()
    }
  })
}
