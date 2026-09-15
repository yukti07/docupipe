#!/usr/bin/env node
/**
 * Apply migrations to Cloud SQL, through the connector.
 *
 * WHY THIS EXISTS RATHER THAN `prisma migrate deploy`
 *
 * Prisma takes a connection URL. Reaching Cloud SQL without a public
 * allowlist means the Cloud SQL connector, which supplies a socket rather than
 * a URL — so `prisma migrate deploy` cannot be pointed at it directly. The
 * usual answer is to run the `cloud-sql-proxy` binary and give Prisma a
 * localhost URL; this does the same job without that download.
 *
 * It writes Prisma's own `_prisma_migrations` bookkeeping, with Prisma's
 * checksum, so the database stays consistent with the tool that owns the
 * schema. `prisma migrate status` will agree with it afterwards, and a later
 * `prisma migrate deploy` will correctly see nothing to do.
 *
 *   node scripts/migrate.mjs                       # apply
 *   node scripts/migrate.mjs --dry-run             # show what would happen
 *   node scripts/migrate.mjs --status              # what is applied
 *
 * Connection, in order of preference:
 *
 *   DATABASE_URL                     a plain URL (local, or cloud-sql-proxy)
 *   INSTANCE_CONNECTION_NAME + DB_*  the connector, using ADC
 */

import { createHash } from "node:crypto"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const { Client } = pg
const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(HERE, "..", "prisma", "migrations")

const args = process.argv.slice(2)
const DRY_RUN = args.includes("--dry-run")
const STATUS_ONLY = args.includes("--status")

/** Prisma checksums the raw bytes of migration.sql with sha256. */
function checksum(sql) {
  return createHash("sha256").update(sql).digest("hex")
}

function discoverMigrations() {
  if (!existsSync(MIGRATIONS_DIR)) return []
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort() // timestamp-prefixed, so lexical order is chronological
    .map((name) => {
      const file = join(MIGRATIONS_DIR, name, "migration.sql")
      if (!existsSync(file)) return null
      const sql = readFileSync(file, "utf8")
      return { name, sql, checksum: checksum(sql) }
    })
    .filter(Boolean)
}

async function connect() {
  if (process.env.DATABASE_URL) {
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 20_000,
    })
    await client.connect()
    return { client, how: "DATABASE_URL" }
  }

  const instance = process.env.INSTANCE_CONNECTION_NAME
  if (!instance) {
    throw new Error(
      "No connection configured.\n\n" +
        "  Either:  DATABASE_URL=postgresql://user:pass@host:5432/dbname\n" +
        "  Or:      INSTANCE_CONNECTION_NAME=project:region:instance\n" +
        "           DB_NAME=...  DB_USER=...  DB_PASSWORD=...\n" +
        "           plus Application Default Credentials.",
    )
  }

  for (const key of ["DB_NAME", "DB_USER", "DB_PASSWORD"]) {
    if (!process.env[key]) throw new Error(`${key} is required when using the connector`)
  }

  const { Connector, IpAddressTypes } = await import("@google-cloud/cloud-sql-connector")
  const connector = new Connector()
  const clientOpts = await connector.getOptions({
    instanceConnectionName: instance,
    ipType: (process.env.DB_IP_TYPE ?? "PUBLIC") === "PRIVATE"
      ? IpAddressTypes.PRIVATE
      : IpAddressTypes.PUBLIC,
  })

  const client = new Client({
    ...clientOpts,
    // Passed as a parameter, so mixed-case names like "ZampDB" survive
    // exactly as written — unlike an unquoted identifier inside SQL.
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: 30_000,
  })

  await client.connect()
  return { client, connector, how: `connector → ${instance}` }
}

async function ensureBookkeeping(client) {
  // Exactly Prisma's own table, so `prisma migrate status` agrees with us.
  await client.query(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id"                  VARCHAR(36)  PRIMARY KEY,
      "checksum"            VARCHAR(64)  NOT NULL,
      "finished_at"         TIMESTAMPTZ,
      "migration_name"      VARCHAR(255) NOT NULL,
      "logs"                TEXT,
      "rolled_back_at"      TIMESTAMPTZ,
      "started_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER      NOT NULL DEFAULT 0
    )
  `)
}

async function appliedNames(client) {
  const { rows } = await client.query(
    `SELECT migration_name, checksum, finished_at, rolled_back_at
       FROM "_prisma_migrations" ORDER BY started_at`,
  )
  return rows
}

async function main() {
  const migrations = discoverMigrations()
  if (migrations.length === 0) {
    console.log("No migrations found in prisma/migrations.")
    return 1
  }

  const { client, connector, how } = await connect()

  try {
    const { rows } = await client.query(
      "SELECT current_database() db, current_user usr, version() v",
    )
    console.log(`\nConnected via ${how}`)
    console.log(`  database  ${rows[0].db}`)
    console.log(`  user      ${rows[0].usr}`)
    console.log(`  server    ${rows[0].v.split(" ").slice(0, 2).join(" ")}\n`)

    await ensureBookkeeping(client)
    const applied = await appliedNames(client)
    const doneOk = new Map(
      applied.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => [r.migration_name, r]),
    )

    if (STATUS_ONLY) {
      for (const m of migrations) {
        const record = doneOk.get(m.name)
        const drifted = record && record.checksum !== m.checksum
        console.log(
          `  ${record ? (drifted ? "DRIFT " : "applied") : "pending"}  ${m.name}` +
            (drifted ? "\n            the file changed after it was applied" : ""),
        )
      }
      return 0
    }

    const pending = migrations.filter((m) => !doneOk.has(m.name))

    for (const m of migrations) {
      const record = doneOk.get(m.name)
      if (record && record.checksum !== m.checksum) {
        console.log(
          `  DRIFT   ${m.name}\n` +
            `          Already applied, but the file has changed since. Not re-running —\n` +
            `          edit forward with a NEW migration rather than changing this one.`,
        )
      }
    }

    if (pending.length === 0) {
      console.log("Nothing to apply — the database is up to date.\n")
      return 0
    }

    console.log(`${pending.length} migration(s) to apply:`)
    for (const m of pending) console.log(`  · ${m.name}`)
    console.log()

    if (DRY_RUN) {
      console.log("--dry-run: nothing was written.\n")
      return 0
    }

    for (const m of pending) {
      process.stdout.write(`  applying ${m.name} ... `)
      const id = crypto.randomUUID()
      const started = new Date()

      try {
        // One transaction per migration: a failure leaves the database exactly
        // as it was, rather than half-migrated with no record of it.
        await client.query("BEGIN")
        await client.query(m.sql)
        await client.query(
          `INSERT INTO "_prisma_migrations"
             (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
           VALUES ($1, $2, now(), $3, $4, 1)`,
          [id, m.checksum, m.name, started],
        )
        await client.query("COMMIT")
        console.log("ok")
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {})
        console.log("FAILED")
        console.error(`\n  ${error.message}\n`)
        if (/already exists/i.test(error.message)) {
          console.error(
            "  Something in this migration is already in the database, but Prisma has\n" +
              "  no record of it. Either this database was set up by hand, or the\n" +
              "  bookkeeping table was lost. Inspect it before forcing anything.\n",
          )
        }
        return 1
      }
    }

    const tables = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )
    const enums = await client.query(
      `SELECT typname FROM pg_type WHERE typtype = 'e' ORDER BY typname`,
    )

    console.log(`\n  tables  ${tables.rows.map((r) => r.tablename).join(", ")}`)
    console.log(`  enums   ${enums.rows.map((r) => r.typname).join(", ")}\n`)
    return 0
  } finally {
    await client.end().catch(() => {})
    connector?.close()
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`\n${error.message}\n`)
    process.exit(1)
  })
