#!/usr/bin/env node
/**
 * The pipeline end to end, driven the way the backend drives it, watched
 * through the database it actually writes.
 *
 * This does not go through the Next.js API — it does what the API does. It
 * writes the same rows `/api/getSignedUrl` and `/api/upload` write, uploads
 * the same object to the same key, and publishes the same message to the same
 * topic. Then it polls the tables the worker writes, until they settle.
 *
 * That makes it useful before the app is deployed anywhere, and it makes the
 * failures legible: every stage is a row you can look at, not a screen.
 *
 *   node infra/e2e/db-flow.mjs
 *   node infra/e2e/db-flow.mjs --keep          leave the rows behind
 *   node infra/e2e/db-flow.mjs --skip-sweep    don't test the outbox relay
 *
 * Reads the database credentials from packages/web/.env.local and never
 * prints them. Needs ADC with roles/cloudsql.client.
 */

import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"

// The two client libraries are already vendored for infra/preflight; resolving
// from there keeps this script install-free.
const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, "..", "preflight", "package.json"))
const { Connector, IpAddressTypes } = require("@google-cloud/cloud-sql-connector")
const { Pool } = require("pg")
const { PubSub } = require("@google-cloud/pubsub")
const { Storage } = require("@google-cloud/storage")

const args = new Set(process.argv.slice(2))
const KEEP = args.has("--keep")
const SKIP_SWEEP = args.has("--skip-sweep")
/** Just the outbox relay — the quick check after redeploying a worker. */
const SWEEP_ONLY = args.has("--sweep-only")

const CFG = {
  project: "project-cf6fd144-baf2-463b-9cd",
  bucket: "zamptestbucket",
  topicUploaded: "file-uploaded",
  topicConvert: "convert-requested",
  schemaTimeoutMs: 180_000,
  convertTimeoutMs: 240_000,
  sweepTimeoutMs: 150_000,
  pollMs: 3000,
}

const C = process.stdout.isTTY
  ? { dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", bold: "\x1b[1m", off: "\x1b[0m" }
  : { dim: "", red: "", green: "", yellow: "", cyan: "", bold: "", off: "" }

const results = []
const section = (t) => console.log(`\n${C.bold}${C.cyan}${t}${C.off}`)
const note = (t) => console.log(`  ${C.dim}${t}${C.off}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function record(ok, label, detail) {
  results.push({ ok, label })
  const mark = ok === true ? `${C.green}PASS${C.off}` : ok === false ? `${C.red}FAIL${C.off}` : `${C.yellow}····${C.off}`
  console.log(`  ${mark}  ${label}`)
  if (detail) console.log(`        ${C.dim}${String(detail).replace(/\n/g, "\n        ")}${C.off}`)
}

/* ------------------------------------------------------------------- ids */

// The API's own id shapes, and the CHECK constraints on the tables:
// users.id 22–64 chars, requests.id 8–64, both [A-Za-z0-9_-].
const USER_ID = randomBytes(16).toString("base64url")
const REQUEST_ID = `e2edb${randomBytes(9).toString("base64url")}`
const FILE_ID = `file_${randomBytes(8).toString("base64url")}`
const TRACE_ID = `req_${randomBytes(8).toString("hex")}`
const FILE_NAME = "e2e-invoices.csv"
const OBJECT_KEY = `requests/${REQUEST_ID}/input/${FILE_ID}-${FILE_NAME}`

/** What the worker derives, reproduced here so the poll knows where to look. */
const RECORD_TABLE = `structured_records_${createHash("sha256").update(FILE_ID).digest("hex").slice(0, 24)}`

const CSV = [
  "invoice_id,issued_on,customer,amount,paid",
  "INV-1044,2026-01-14,Northwind Trading,1284.50,true",
  "INV-1045,2026-01-15,Contoso Limited,930.00,false",
  "INV-1046,2026-01-16,Fabrikam Inc,2210.75,true",
  "INV-1047,2026-01-17,Adventure Works,145.20,true",
].join("\n")

/* --------------------------------------------------------------- plumbing */

function credentials() {
  const raw = readFileSync(join(here, "..", "..", "packages", "web", ".env.local"), "utf8")
  const get = (key) => (raw.match(new RegExp(`^${key}=(.*)$`, "m")) ?? [])[1]?.trim()
  return {
    instance: get("INSTANCE_CONNECTION_NAME"),
    user: get("DB_USER"),
    password: get("DB_PASSWORD"),
    database: get("DB_NAME"),
  }
}

let connector = null
async function connect() {
  const creds = credentials()
  if (!creds.instance) throw new Error("INSTANCE_CONNECTION_NAME is not in packages/web/.env.local")
  connector = new Connector()
  const opts = await connector.getOptions({ instanceConnectionName: creds.instance, ipType: IpAddressTypes.PUBLIC })
  return new Pool({ ...opts, user: creds.user, password: creds.password, database: creds.database, max: 2 })
}

/**
 * Poll until `check` returns something truthy, printing each distinct state
 * once. Returns null on timeout.
 */
async function waitFor(label, timeoutMs, probe, describe) {
  const deadline = Date.now() + timeoutMs
  let lastSeen = null
  while (Date.now() < deadline) {
    const state = await probe()
    const rendered = describe(state)
    if (rendered !== lastSeen) {
      console.log(`  ${C.dim}${new Date().toISOString().slice(11, 19)}  ${rendered}${C.off}`)
      lastSeen = rendered
    }
    if (state.done) return state
    await sleep(CFG.pollMs)
  }
  record(false, `${label} did not settle within ${timeoutMs / 1000}s`, `last state: ${lastSeen}`)
  return null
}

/* ------------------------------------------------------------------ steps */

async function seed(pool) {
  section("1 · Seed — exactly the rows the backend writes")

  await new Storage().bucket(CFG.bucket).file(OBJECT_KEY).save(Buffer.from(CSV, "utf8"), {
    contentType: "text/csv",
    resumable: false,
  })
  record(true, "uploaded the object", `gs://${CFG.bucket}/${OBJECT_KEY} (${CSV.length} B)`)

  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query(
      `INSERT INTO users (id, created_at, updated_at, last_seen_at) VALUES ($1, now(), now(), now())
       ON CONFLICT (id) DO NOTHING`, [USER_ID])
    await client.query(
      `INSERT INTO user_allowance (user_id, used, daily_limit, resets_at, updated_at)
       VALUES ($1, 0, 5000, now() + interval '1 day', now()) ON CONFLICT (user_id) DO NOTHING`, [USER_ID])
    await client.query(
      `INSERT INTO requests (id, user_id, status, file_count, created_at, updated_at)
       VALUES ($1, $2, 'COLLECTING', 1, now(), now())`, [REQUEST_ID, USER_ID])

    // getSignedUrl writes the row at UPLOADING with bucket + object_key; the
    // confirm step is what sets the size and moves it to UPLOADED.
    await client.query(
      `INSERT INTO files (id, request_id, user_id, original_filename, content_type, bucket, object_key,
                          stage, attempts, max_attempts, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'text/csv', $5, $6, 'UPLOADING', 0, 5, now(), now())`,
      [FILE_ID, REQUEST_ID, USER_ID, FILE_NAME, CFG.bucket, OBJECT_KEY])
    await client.query(
      `UPDATE files SET stage = 'UPLOADED', size_bytes = $2, uploaded_at = now(), updated_at = now()
        WHERE id = $1`, [FILE_ID, CSV.length])

    await client.query(
      `INSERT INTO file_events (request_id, file_id, user_id, request_trace_id, event_type, created_at)
       VALUES ($1, $2, $3, $4, 'UPLOAD_CONFIRMED', now())`, [REQUEST_ID, FILE_ID, USER_ID, TRACE_ID])
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }

  record(true, "seeded users / requests / files", `file ${FILE_ID} at UPLOADED\n        request ${REQUEST_ID}`)
  note(`records will land in ${RECORD_TABLE}`)
}

async function publish(topic, attributes) {
  // Byte-for-byte what packages/web/src/server/publish.ts sends: the payload
  // is the file id and nothing else, and everything that is only for
  // correlation travels as an attribute.
  const [messageId] = await new PubSub({ projectId: CFG.project })
    .topic(topic)
    .publishMessage({ data: Buffer.from(JSON.stringify({ fileId: FILE_ID })), attributes })
  return messageId
}

async function detect(pool) {
  section("2 · Schema detection — publish, then watch the tables")

  await pool.query(
    `INSERT INTO request_outbox (request_id, file_id, topic, payload, status, attempts, next_attempt_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, 'PUBLISHED', 0, now(), now(), now())`,
    [REQUEST_ID, FILE_ID, CFG.topicUploaded, JSON.stringify({ fileId: FILE_ID })])

  const messageId = await publish(CFG.topicUploaded, { requestTraceId: TRACE_ID, userId: USER_ID, requestId: REQUEST_ID })
  record(true, `published to ${CFG.topicUploaded}`, `messageId ${messageId}  payload {"fileId":"${FILE_ID}"}`)

  const settled = await waitFor("schema detection", CFG.schemaTimeoutMs, async () => {
    const { rows } = await pool.query(
      `SELECT f.stage::text AS stage, f.failure_class::text AS failure_class, f.failure_detail, f.claimed_by,
              f.detected_content_type, f.attempts,
              (SELECT count(*)::int FROM file_schemas s WHERE s.file_id = f.id) AS schemas,
              (SELECT count(*)::int FROM file_schema_versions v WHERE v.file_id = f.id) AS versions,
              (SELECT count(*)::int FROM file_events e WHERE e.file_id = f.id) AS events,
              (SELECT r.stage::text FROM file_schema_results r WHERE r.file_id = f.id LIMIT 1) AS result_stage
         FROM files f WHERE f.id = $1`, [FILE_ID])
    const row = rows[0]
    return { ...row, done: row.stage === "SCHEMA_READY" || row.stage === "FAILED" }
  }, (s) => `stage=${s.stage} schemas=${s.schemas} versions=${s.versions} result=${s.result_stage ?? "-"} events=${s.events} attempts=${s.attempts}`)

  if (!settled) return false
  if (settled.stage === "FAILED") {
    record(false, "the detector failed the file", `${settled.failure_class} — ${settled.failure_detail}`)
    return false
  }

  record(true, "files.stage reached SCHEMA_READY", `detected_content_type = ${settled.detected_content_type ?? "(not set)"}`)
  record(settled.schemas === 1, "file_schemas has a row", `${settled.schemas} row(s)`)
  record(settled.versions === 1, "file_schema_versions has the v1 detected row", `${settled.versions} row(s)`)
  record(settled.result_stage === "QUEUED", "file_schema_results seeded at QUEUED",
    settled.result_stage === "DONE"
      ? "DONE at detection time — the old behaviour; the result screen will show a conversion that never ran"
      : `stage=${settled.result_stage}`)
  record(settled.claimed_by === null, "the lease was released", `claimed_by = ${settled.claimed_by ?? "null"}`)

  const { rows: schemas } = await pool.query(
    `SELECT id, table_ord, table_label, version, shape_hash, fields FROM file_schemas WHERE file_id = $1 ORDER BY table_ord`, [FILE_ID])
  for (const s of schemas) {
    const fields = s.fields.map((f) => `${f.key}:${f.type}${f.origin ? "" : " ⚠no-origin"}`).join(", ")
    record(true, `schema ${s.id} (table_ord ${s.table_ord})`,
      `label "${s.table_label}" v${s.version} shape_hash ${s.shape_hash}\n        ${fields}`)
    record(s.fields.every((f) => f.origin === "detected"), "every field carries origin=detected",
      s.fields.every((f) => f.origin) ? null : "the schema editor cannot mark added fields without it")
  }

  const { rows: versions } = await pool.query(
    `SELECT id, version, status, source FROM file_schema_versions WHERE file_id = $1 ORDER BY version`, [FILE_ID])
  for (const v of versions) note(`file_schema_versions  v${v.version} ${v.status} ${v.source}  ${v.id}`)

  return true
}

async function convert(pool) {
  section("3 · Conversion — the gate, then the worker")

  // What /api/convert does: move the settled file to CONVERTING, write the
  // outbox row in the same transaction, then publish.
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const { rows } = await client.query(
      `UPDATE files SET stage = 'CONVERTING', updated_at = now()
        WHERE request_id = $1 AND stage = 'SCHEMA_READY' RETURNING id`, [REQUEST_ID])
    await client.query(
      `UPDATE requests SET status = 'CONVERTING', converted_at = now(), updated_at = now() WHERE id = $1`, [REQUEST_ID])
    await client.query(
      `INSERT INTO request_outbox (request_id, file_id, topic, payload, status, attempts, next_attempt_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, 'PUBLISHED', 0, now(), now(), now())`,
      [REQUEST_ID, FILE_ID, CFG.topicConvert, JSON.stringify({ fileId: FILE_ID })])
    await client.query("COMMIT")
    record(rows.length === 1, "the gate moved the file to CONVERTING", `${rows.length} file(s)`)
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }

  const messageId = await publish(CFG.topicConvert, { requestTraceId: TRACE_ID, userId: USER_ID, requestId: REQUEST_ID })
  record(true, `published to ${CFG.topicConvert}`, `messageId ${messageId}  payload {"fileId":"${FILE_ID}"}`)

  const settled = await waitFor("conversion", CFG.convertTimeoutMs, async () => {
    const { rows } = await pool.query(
      `SELECT f.stage::text AS stage, f.failure_class::text AS failure_class, f.failure_detail,
              (SELECT r.stage::text FROM file_schema_results r WHERE r.file_id = f.id LIMIT 1) AS result_stage,
              (SELECT r.row_count FROM file_schema_results r WHERE r.file_id = f.id LIMIT 1) AS row_count,
              (SELECT p.status FROM processing_runs p WHERE p.file_id = f.id ORDER BY p.created_at DESC LIMIT 1) AS run_status,
              (SELECT p.records_processed FROM processing_runs p WHERE p.file_id = f.id ORDER BY p.created_at DESC LIMIT 1) AS processed,
              (SELECT count(*)::int FROM file_schema_versions v WHERE v.file_id = f.id AND v.status = 'APPROVED') AS approved,
              (SELECT req.status::text FROM requests req WHERE req.id = f.request_id) AS request_status
         FROM files f WHERE f.id = $1`, [FILE_ID])
    const row = rows[0]
    return { ...row, done: row.stage === "COMPLETED" || row.stage === "FAILED" }
  }, (s) => `stage=${s.stage} result=${s.result_stage ?? "-"} rows=${s.row_count ?? 0} run=${s.run_status ?? "-"}/${s.processed ?? 0} approved=${s.approved} request=${s.request_status}`)

  if (!settled) return false
  if (settled.stage === "FAILED") {
    record(false, "the processor failed the file", `${settled.failure_class} — ${settled.failure_detail}`)
    await dumpRecords(pool)
    return false
  }

  record(true, "files.stage reached COMPLETED", null)

  // The worker settles the file and recomputes the request in two separate
  // transactions, so reading both in one query catches the gap between them.
  let requestStatus = settled.request_status
  for (let attempt = 0; attempt < 6 && requestStatus === "CONVERTING"; attempt += 1) {
    await sleep(2000)
    const { rows } = await pool.query(`SELECT status::text AS status FROM requests WHERE id = $1`, [REQUEST_ID])
    requestStatus = rows[0].status
  }

  record(settled.approved >= 1, "an APPROVED file_schema_versions row was snapshotted", `${settled.approved} approved version(s)`)
  record(settled.run_status === "COMPLETED", "processing_runs reached COMPLETED", `status ${settled.run_status}`)
  record(settled.result_stage === "DONE", "file_schema_results reached DONE", `stage ${settled.result_stage}`)
  record(settled.row_count > 0, "file_schema_results carries a row count", `row_count ${settled.row_count}`)
  record(requestStatus === "COMPLETED", "requests.status was recomputed", `status ${requestStatus}`)

  const { rows: runs } = await pool.query(
    `SELECT id, status, file_schema_version_id, records_total, records_processed, records_failed, error_code, error_message
       FROM processing_runs WHERE file_id = $1 ORDER BY created_at`, [FILE_ID])
  for (const r of runs) {
    note(`processing_runs  ${r.id}`)
    note(`                 ${r.status}  total=${r.records_total} processed=${r.records_processed} failed=${r.records_failed}`)
    note(`                 against schema version ${r.file_schema_version_id}`)
    if (r.error_code) note(`                 ${r.error_code}: ${r.error_message}`)
  }

  return dumpRecords(pool)
}

async function dumpRecords(pool) {
  section(`4 · Structured records — ${RECORD_TABLE}`)

  const { rows: exists } = await pool.query(
    `SELECT to_regclass($1) IS NOT NULL AS present`, [`public.${RECORD_TABLE}`])
  if (!exists[0].present) {
    record(false, "the per-file record table was created", `${RECORD_TABLE} does not exist`)
    return false
  }
  record(true, "the per-file record table was created", RECORD_TABLE)

  const { rows } = await pool.query(
    `SELECT record_number, status, data FROM ${RECORD_TABLE} ORDER BY record_number`)
  record(rows.length > 0, `records were written`, `${rows.length} row(s)`)
  for (const row of rows.slice(0, 10)) {
    console.log(`        ${C.dim}#${String(row.record_number).padStart(3)} ${row.status}  ${JSON.stringify(row.data)}${C.off}`)
  }

  const { rows: errors } = await pool.query(
    `SELECT e.record_number, e.field_name, e.error_code, e.message
       FROM record_errors e JOIN processing_runs p ON p.id = e.processing_run_id
      WHERE p.file_id = $1 ORDER BY e.record_number LIMIT 20`, [FILE_ID])
  if (errors.length > 0) {
    record(null, `${errors.length} record error(s)`, errors.map((e) =>
      `#${e.record_number} ${e.field_name ?? "-"} ${e.error_code}: ${e.message}`).join("\n        "))
  } else {
    record(true, "no record errors", null)
  }

  // The rows the pipeline wrote should be the rows the file held.
  const expected = CSV.split("\n").length - 1
  record(rows.length + errors.length >= expected, "every source row was accounted for",
    `${rows.length} written + ${errors.length} errored, ${expected} in the file`)
  return rows.length > 0
}

async function testSweep(pool) {
  section("5 · The sweep — outbox relay")

  // A PENDING row nobody publishes. If the relay is working, the scheduled
  // sweep finds it within a minute and flips it to PUBLISHED. This is the
  // recovery path for a Vercel publish that failed, and it is otherwise
  // exercised by nothing.
  const { rows } = await pool.query(
    `INSERT INTO request_outbox (request_id, file_id, topic, payload, status, attempts, next_attempt_at, created_at, updated_at)
     VALUES ($1, NULL, $2, $3::jsonb, 'PENDING', 0, now(), now(), now()) RETURNING id`,
    [REQUEST_ID, CFG.topicUploaded, JSON.stringify({ fileId: FILE_ID, sweepProbe: true })])
  const outboxId = rows[0].id
  record(true, "wrote a PENDING outbox row nobody will publish inline", `id ${outboxId}`)
  note("Cloud Scheduler runs the sweep once a minute; waiting for it to relay this row")

  const settled = await waitFor("the sweep", CFG.sweepTimeoutMs, async () => {
    const { rows: probe } = await pool.query(
      `SELECT status::text AS status, attempts, last_error, published_at FROM request_outbox WHERE id = $1`, [outboxId])
    const row = probe[0]
    // The relay backs the row off on CLAIM and only then publishes, so
    // `attempts > 0` while still PENDING is the middle of a sweep, not the
    // end of one. It is settled when the status moves or an error is written.
    return { ...row, done: row.status !== "PENDING" || row.last_error !== null }
  }, (s) => `status=${s.status} attempts=${s.attempts}${s.last_error ? ` error=${s.last_error.slice(0, 80)}` : ""}`)

  if (!settled) {
    record(false, "the sweep never touched the row",
      "Either Cloud Scheduler is not firing, or /internal/sweep is not served.\n        Check: gcloud scheduler jobs describe quarry-inspect-sweep --location=asia-south1")
    return false
  }
  record(settled.status === "PUBLISHED", "the sweep relayed the outbox row",
    settled.status === "PUBLISHED"
      ? `published_at ${settled.published_at?.toISOString?.() ?? settled.published_at}`
      : `status ${settled.status}, attempts ${settled.attempts}, last_error ${settled.last_error}`)
  return settled.status === "PUBLISHED"
}

async function cleanup(pool) {
  section("Cleanup")
  // requests/files/file_schemas cascade from users; the per-file record table
  // and the run rows do not, so they go explicitly.
  await pool.query(`DELETE FROM record_errors WHERE processing_run_id IN (SELECT id FROM processing_runs WHERE file_id = $1)`, [FILE_ID])
  await pool.query(`DELETE FROM processing_runs WHERE file_id = $1`, [FILE_ID])
  await pool.query(`DELETE FROM file_schema_versions WHERE file_id = $1`, [FILE_ID])
  await pool.query(`DROP TABLE IF EXISTS ${RECORD_TABLE}`)
  await pool.query(`DELETE FROM users WHERE id = $1`, [USER_ID])
  await new Storage().bucket(CFG.bucket).deleteFiles({ prefix: `requests/${REQUEST_ID}/` })
  record(true, "removed the test rows and objects", `user ${USER_ID}, request ${REQUEST_ID}, table ${RECORD_TABLE}`)
}

/* -------------------------------------------------------------------- run */

async function main() {
  console.log(`${C.bold}Pipeline end-to-end, through the database${C.off}`)
  note(`project ${CFG.project}   bucket ${CFG.bucket}`)

  const pool = await connect()
  record(true, "connected to Cloud SQL", credentials().instance)

  let ok = false
  try {
    if (SWEEP_ONLY) {
      // The outbox row carries a foreign key to `requests`, so even the
      // standalone check needs a user and a request behind it.
      await pool.query(`INSERT INTO users (id, created_at, updated_at, last_seen_at) VALUES ($1, now(), now(), now())
                        ON CONFLICT (id) DO NOTHING`, [USER_ID])
      await pool.query(`INSERT INTO requests (id, user_id, status, file_count, created_at, updated_at)
                        VALUES ($1, $2, 'COLLECTING', 0, now(), now())`, [REQUEST_ID, USER_ID])
      ok = await testSweep(pool)
    } else {
      await seed(pool)
      if (await detect(pool)) ok = await convert(pool)
      if (!SKIP_SWEEP) ok = (await testSweep(pool)) && ok
    }
  } finally {
    if (!KEEP) {
      try { await cleanup(pool) } catch (error) { record(null, "cleanup did not complete", error.message) }
    } else {
      note(`kept: file ${FILE_ID}, request ${REQUEST_ID}, table ${RECORD_TABLE}`)
    }
    await pool.end()
    connector?.close()
  }

  section("Summary")
  const failed = results.filter((r) => r.ok === false)
  console.log(`  ${C.green}${results.filter((r) => r.ok === true).length} passed${C.off}   ` +
              `${C.yellow}${results.filter((r) => r.ok === null).length} notes${C.off}   ` +
              `${C.red}${failed.length} failed${C.off}`)
  for (const f of failed) console.log(`    ${C.red}·${C.off} ${f.label}`)
  console.log("")
  process.exit(failed.length === 0 && ok ? 0 : 1)
}

main().catch((error) => {
  console.error(`\n${C.red}${error.stack ?? error.message}${C.off}\n`)
  process.exit(2)
})
