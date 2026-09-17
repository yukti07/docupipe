#!/usr/bin/env node
/**
 * End-to-end flow against REAL infrastructure.
 *
 * Drives the deployed Next.js backend over HTTP exactly as the browser does —
 * register, signed URL, PUT the bytes, confirm — then watches what the real
 * Pub/Sub topics and the real Cloud Run workers do about it, and polls the
 * real schema and result endpoints until they settle or time out.
 *
 * Nothing is mocked and nothing is stubbed. That is the point: the failures
 * this is built to catch (a push subscription aimed at the wrong service, an
 * enum value Postgres rejects, a worker that acks a message it could not
 * parse) are all invisible to a test with a fake broker in it.
 *
 * Read-only against GCP apart from the object it uploads and the rows the
 * flow itself creates. It never redeploys, never edits IAM, never edits a
 * subscription. When something is wrong it says so and tells you which
 * command to run next.
 *
 *   node infra/e2e/e2e-flow.mjs --base-url https://<app>.vercel.app
 *   node infra/e2e/e2e-flow.mjs --base-url http://localhost:3000 --preflight-only
 *
 * No npm install: node builtins and the `gcloud` on PATH, nothing else.
 */

import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/* ------------------------------------------------------------------ config */

const args = parseArgs(process.argv.slice(2))

const CFG = {
  baseUrl: (args["base-url"] ?? process.env.QUARRY_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
  project: args.project ?? process.env.GCP_PROJECT_ID ?? "project-cf6fd144-baf2-463b-9cd",
  region: args.region ?? process.env.GCP_REGION ?? "asia-south1",
  bucket: args.bucket ?? process.env.GCS_BUCKET_NAME ?? "zamptestbucket",

  topicUploaded: process.env.PUBSUB_TOPIC_FILE_UPLOADED ?? "file-uploaded",
  topicConvert: process.env.PUBSUB_TOPIC_CONVERT_REQUESTED ?? "convert-requested",
  subUploaded: "quarry-file-uploaded-push",
  subConvert: "quarry-convert-requested-push",
  dlqUploaded: "file-uploaded-dlq-sub",
  dlqConvert: "convert-requested-dlq-sub",

  // Pull subscriptions on the same two topics. Pulling from these shows the
  // exact bytes the backend published without touching what the push
  // subscription delivers — every subscription gets its own copy.
  tapUploaded: "file-uploaded-local",
  tapConvert: "convert-requested-local",

  inspectService: args["inspect-service"] ?? "quarry-inspect-worker",
  convertService: args["convert-service"] ?? "quarry-convert-worker",

  schemaTimeoutMs: Number(args["schema-timeout"] ?? 180) * 1000,
  resultTimeoutMs: Number(args["result-timeout"] ?? 300) * 1000,
  pollIntervalMs: 5000,

  preflightOnly: Boolean(args["preflight-only"]),
  skipConvert: Boolean(args["skip-convert"]),
  fixture: args.file ?? null,
  verbose: Boolean(args.verbose),
}

/* ------------------------------------------------------------------ output */

const C = process.stdout.isTTY
  ? { dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", bold: "\x1b[1m", off: "\x1b[0m" }
  : { dim: "", red: "", green: "", yellow: "", cyan: "", bold: "", off: "" }

/** Every assertion lands here, so the run ends with one table instead of a scroll. */
const findings = []

function record(stage, ok, label, detail) {
  findings.push({ stage, ok, label, detail })
  const mark = ok === true ? `${C.green}PASS${C.off}` : ok === false ? `${C.red}FAIL${C.off}` : `${C.yellow}WARN${C.off}`
  console.log(`  ${mark}  ${label}`)
  if (detail) console.log(`        ${C.dim}${detail}${C.off}`)
}

const section = (title) => console.log(`\n${C.bold}${C.cyan}${title}${C.off}`)
const note = (text) => console.log(`  ${C.dim}${text}${C.off}`)

/* ------------------------------------------------------------------ gcloud */

function gcloud(argv, { json = true, allowFail = false } = {}) {
  const full = [...argv, `--project=${CFG.project}`]
  if (json) full.push("--format=json")
  try {
    const out = execFileSync("gcloud", full, {
      encoding: "utf8",
      // gcloud on Windows prints a Python deprecation warning to stderr on
      // every call; swallowing it keeps the report readable.
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
      shell: process.platform === "win32",
    })
    return json ? JSON.parse(out || "null") : out
  } catch (error) {
    if (allowFail) return null
    throw new Error(`gcloud ${argv.join(" ")} failed: ${String(error.stderr ?? error.message).trim().split("\n").slice(-3).join(" ")}`)
  }
}

/* -------------------------------------------------------------------- http */

/**
 * The session is an httpOnly `sid` cookie set by /api/register, and every
 * later call is rejected without it. fetch does not keep a cookie jar, so
 * this holds the one cookie that matters.
 */
let cookie = null

async function post(path, body) {
  const headers = { "Content-Type": "application/json" }
  if (cookie) headers.Cookie = cookie

  const response = await fetch(`${CFG.baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })

  const setCookie = response.headers.get("set-cookie")
  if (setCookie) cookie = setCookie.split(";")[0]

  const text = await response.text()
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    /* an HTML error page from the platform, not the app — keep the text */
  }

  if (CFG.verbose) console.log(`  ${C.dim}POST ${path} -> ${response.status} ${text.slice(0, 300)}${C.off}`)

  return { status: response.status, body: parsed, raw: text, traceId: response.headers.get("x-request-id") }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ----------------------------------------------------------------- phase 0 */

/**
 * Infrastructure truth before the flow runs.
 *
 * The check that earns its place here is the push-endpoint comparison: a
 * subscription pointing at a service that is not the one you deployed fails
 * silently and looks exactly like a worker bug for as long as you let it.
 */
function preflight() {
  section("0 · Preflight — real GCP state")

  const services = gcloud(["run", "services", "list"]) ?? []
  const byName = new Map(services.map((s) => [s.metadata?.name, s]))

  const live = {}
  for (const [label, name] of [["inspect", CFG.inspectService], ["convert", CFG.convertService]]) {
    const svc = byName.get(name)
    if (!svc) {
      record("preflight", false, `Cloud Run service ${name} exists`, `not found in project ${CFG.project}`)
      continue
    }
    const url = svc.status?.url
    const sa = svc.spec?.template?.spec?.serviceAccountName
    const image = svc.spec?.template?.spec?.containers?.[0]?.image
    live[label] = { name, url, sa, image, region: svc.metadata?.labels?.["cloud.googleapis.com/location"] }
    record("preflight", true, `Cloud Run ${name}`, `${url}\n        image ${image}\n        runs as ${sa}`)
  }

  // Duplicate deployments of the same image under a different name are the
  // usual cause of a subscription pointing somewhere unexpected, so name them.
  const others = services.filter((s) => ![CFG.inspectService, CFG.convertService].includes(s.metadata?.name))
  if (others.length > 0) {
    record("preflight", null, `${others.length} other Cloud Run service(s) in this project`,
      others.map((s) => `${s.metadata.name} — ${s.status?.url}`).join("\n        "))
  }

  for (const [sub, expect, label] of [
    [CFG.subUploaded, live.inspect, "schema detection"],
    [CFG.subConvert, live.convert, "conversion"],
  ]) {
    const detail = gcloud(["pubsub", "subscriptions", "describe", sub], { allowFail: true })
    if (!detail) {
      record("preflight", false, `subscription ${sub} exists`, "describe returned nothing")
      continue
    }

    const endpoint = detail.pushConfig?.pushEndpoint ?? ""
    const oidcSa = detail.pushConfig?.oidcToken?.serviceAccountEmail ?? null

    // Cloud Run serves a service on two URL forms (the project-number one and
    // the hashed one), so compare the service name inside the host rather
    // than the whole string.
    const endpointHost = (() => {
      try { return new URL(endpoint).host } catch { return "" }
    })()
    const pointsAtExpected = expect?.name ? endpointHost.startsWith(`${expect.name}-`) : false

    record("preflight", pointsAtExpected, `${label} push endpoint targets ${expect?.name ?? "?"}`,
      pointsAtExpected
        ? endpoint
        : `subscription pushes to ${endpoint}\n        but the deployed service is ${expect?.url}\n        fix: gcloud pubsub subscriptions update ${sub} --push-endpoint="${expect?.url}/" --project=${CFG.project}`)

    record("preflight", Boolean(oidcSa), `${label} push carries an OIDC token`,
      oidcSa
        ? `as ${oidcSa}`
        : `no oidcToken on ${sub}. The service is private, so every push gets 403 and dies in the DLQ after ${detail.deadLetterPolicy?.maxDeliveryAttempts ?? "N"} attempts.\n        fix: gcloud pubsub subscriptions update ${sub} --push-auth-service-account=quarry-pubsub-invoker@${CFG.project}.iam.gserviceaccount.com --project=${CFG.project}`)

    if (detail.deadLetterPolicy) {
      note(`${sub}: ack deadline ${detail.ackDeadlineSeconds}s, DLQ ${detail.deadLetterPolicy.deadLetterTopic?.split("/").pop()} after ${detail.deadLetterPolicy.maxDeliveryAttempts}`)
    }
  }

  const buckets = gcloud(["storage", "buckets", "describe", `gs://${CFG.bucket}`], { allowFail: true })
  record("preflight", Boolean(buckets), `bucket gs://${CFG.bucket} reachable`,
    buckets ? `location ${buckets.location}` : "describe failed — check the name and your ADC")

  // The sweep jobs belong to the outbox design. A job that has been returning
  // NOT_FOUND every minute means the deployed worker has no /internal/sweep,
  // and therefore no recovery path for a publish that failed.
  const jobs = gcloud(["scheduler", "jobs", "list", `--location=${CFG.region}`], { allowFail: true }) ?? []
  for (const job of jobs) {
    const name = job.name?.split("/").pop()
    const code = job.status?.code
    record("preflight", code == null ? null : code === 0,
      `scheduler ${name}`,
      code == null
        ? `${job.state} — ${job.httpTarget?.uri}`
        : `last attempt returned code ${code}${code === 5 ? " (NOT_FOUND — the worker does not serve this path)" : ""}\n        ${job.httpTarget?.uri}`)
  }

  return live
}

/* ----------------------------------------------------------------- phase 1 */

function makeFixture() {
  if (CFG.fixture) {
    return { path: CFG.fixture, name: CFG.fixture.split(/[\\/]/).pop(), bytes: readFileSync(CFG.fixture) }
  }
  // Small, valid, and unambiguously CSV: this test is about the plumbing, and
  // a file the detector has to work at only muddies which half failed.
  const csv = [
    "invoice_id,issued_on,customer,amount,paid",
    "INV-1044,2026-01-14,Northwind Trading,1284.50,true",
    "INV-1045,2026-01-15,Contoso Limited,930.00,false",
    "INV-1046,2026-01-16,Fabrikam Inc,2210.75,true",
  ].join("\n")
  const dir = mkdtempSync(join(tmpdir(), "quarry-e2e-"))
  const path = join(dir, "e2e-invoices.csv")
  writeFileSync(path, csv, "utf8")
  return { path, name: "e2e-invoices.csv", bytes: Buffer.from(csv, "utf8") }
}

async function uploadFlow(fixture) {
  section("1 · Backend — register, sign, upload, confirm")

  // Matches the CHECK constraints the API validates against: userId 22–64,
  // requestId 8–64, both [A-Za-z0-9_-].
  const userId = randomBytes(16).toString("base64url")
  const requestId = `e2e${randomBytes(9).toString("base64url")}`
  note(`userId ${userId}`)
  note(`requestId ${requestId}`)

  const registered = await post("/api/register", { userId })
  record("upload", registered.status === 200 && Boolean(cookie), "POST /api/register",
    registered.status === 200 ? "session cookie received" : `${registered.status} ${registered.raw.slice(0, 200)}`)
  if (registered.status !== 200) return null

  const signed = await post("/api/getSignedUrl", { userId, requestId, files: [fixture.name] })
  const entry = signed.body?.files?.[0]
  record("upload", signed.status === 200 && Boolean(entry?.filePath), "POST /api/getSignedUrl",
    entry ? `fileId ${entry.fileId}` : `${signed.status} ${signed.raw.slice(0, 200)}`)
  if (!entry) return null

  // Relative when STORAGE_BACKEND=local; absolute V4 signed URL on gcs.
  const target = entry.filePath.startsWith("http") ? entry.filePath : `${CFG.baseUrl}${entry.filePath}`
  const put = await fetch(target, { method: "PUT", headers: entry.uploadHeaders, body: fixture.bytes })
  const putBody = put.ok ? "" : (await put.text()).slice(0, 400)
  record("upload", put.ok, `PUT the bytes (${fixture.bytes.length} B)`,
    put.ok
      ? `${put.status} to ${new URL(target).host}`
      : `${put.status} — ${putBody}\n        A 403 here is usually a Content-Type that does not match the one that was signed, or a publisher identity that cannot sign.`)
  if (!put.ok) return null

  const confirmed = await post("/api/upload", { userId, requestId, files: [{ fileId: entry.fileId }] })
  const stage = confirmed.body?.files?.[0]?.stage
  record("upload", confirmed.status === 200 && stage === "UPLOADED", "POST /api/upload (publishes to Pub/Sub)",
    stage === "UPLOADED"
      ? "file reached UPLOADED — the outbox row is committed and the publish has been attempted"
      : `stage ${stage ?? "?"} — ${confirmed.raw.slice(0, 300)}`)

  return { userId, requestId, fileId: entry.fileId, objectKeyHint: `requests/${requestId}/input/${entry.fileId}-` }
}

/* ----------------------------------------------------------------- phase 2 */

function verifyObject(ctx) {
  section("2 · GCS — the object the worker will be told to read")

  const listed = gcloud(["storage", "ls", "--long", `gs://${CFG.bucket}/requests/${ctx.requestId}/input/`], {
    json: false,
    allowFail: true,
  })
  const found = typeof listed === "string" && listed.includes(ctx.fileId)
  record("storage", found, "input object is in the bucket",
    found ? listed.trim().split("\n")[0].trim() : `nothing under gs://${CFG.bucket}/requests/${ctx.requestId}/input/`)
}

/* ---------------------------------------------------------------- the wire */

/**
 * What did the backend actually put on the topic?
 *
 * Every argument about the event contract is settled here rather than by
 * reading either side's source: this is the literal payload, base64-decoded,
 * plus the attributes that travel beside it. The worker must be able to act on
 * exactly this.
 *
 * Pulled without acking, from a subscription the push delivery does not share.
 */
function tapTopic(sub, label, expectFileId, stage) {
  const pulled = gcloud(["pubsub", "subscriptions", "pull", sub, "--limit=10"], { allowFail: true })
  if (pulled === null) {
    record(stage, null, `wire tap on ${label}`, `no pull subscription ${sub} — create one to inspect published messages`)
    return null
  }

  const decoded = pulled.map((m) => {
    let data = "(no data)"
    try {
      data = Buffer.from(m.message?.data ?? "", "base64").toString("utf8")
    } catch {
      /* not base64 — show it as it came */
    }
    return { data, attributes: m.message?.attributes ?? {}, publishTime: m.message?.publishTime }
  })

  const mine = decoded.filter((d) => d.data.includes(expectFileId) || Object.values(d.attributes).includes(expectFileId))
  if (mine.length === 0) {
    record(stage, false, `the backend published to ${label}`,
      `${decoded.length} message(s) on ${sub}, none mentioning ${expectFileId}.\n        The publish never happened, or it went to a different topic.`)
    return null
  }

  for (const message of mine) {
    let parsed = null
    try {
      parsed = JSON.parse(message.data)
    } catch {
      /* left null — reported below */
    }
    record(stage, parsed !== null, `wire payload on ${label} is valid JSON`,
      `${message.data}\n        attributes: ${JSON.stringify(message.attributes)}`)

    if (parsed) {
      // The worker resolves everything else from the file row, so fileId is
      // the only field that has to be there.
      record(stage, Boolean(parsed.fileId ?? parsed.file_id), "payload carries fileId",
        `fileId=${parsed.fileId ?? parsed.file_id ?? "MISSING"}  eventType=${parsed.eventType ?? "(absent)"}`)
      const carriesRequest = Boolean(parsed.requestId ?? message.attributes.requestId)
      record(stage, null, "requestId reaches the worker",
        carriesRequest
          ? `via ${parsed.requestId ? "the payload" : "a Pub/Sub attribute"}`
          : "neither the payload nor an attribute has it — the worker falls back to the files row")
    }
  }
  return mine
}

/* ----------------------------------------------------------------- phase 3 */

/**
 * Did the push actually reach the worker, and what did it answer?
 *
 * A 200 is not success on its own — a worker that cannot parse the envelope
 * and answers 200 makes Pub/Sub discard the message silently. So the log line
 * is reported verbatim rather than reduced to a verdict.
 */
function inspectWorkerLogs(service, sinceIso, stage) {
  const filter = [
    `resource.type="cloud_run_revision"`,
    `resource.labels.service_name="${service}"`,
    `timestamp>="${sinceIso}"`,
  ].join(" AND ")

  const entries = gcloud(["logging", "read", filter, "--limit=40", "--order=asc"], { allowFail: true }) ?? []
  const requests = entries.filter((e) => e.httpRequest?.requestMethod === "POST")

  if (requests.length === 0) {
    record(stage, false, `${service} received a push`,
      `no POST reached this service since ${sinceIso}.\n        Either the message was never published, or the subscription is pushing somewhere else.`)
    return []
  }

  for (const entry of requests) {
    const status = entry.httpRequest.status
    const ok = status >= 200 && status < 300
    record(stage, ok, `${service} answered ${status} to a push`,
      `${entry.httpRequest.requestUrl ?? "/"} in ${entry.httpRequest.latency ?? "?"}`)
  }

  const errors = entries
    .filter((e) => ["ERROR", "CRITICAL", "WARNING"].includes(e.severity))
    .map((e) => (e.textPayload ?? JSON.stringify(e.jsonPayload ?? {})).split("\n").slice(0, 4).join("\n        "))
  if (errors.length > 0) {
    record(stage, null, `${service} logged ${errors.length} warning/error line(s)`, errors.slice(0, 5).join("\n        ---\n        "))
  }

  return requests
}

/**
 * The dead-letter queues, pulled without acking so nothing is consumed.
 *
 * A message here is the single most informative artefact in the whole run: it
 * carries the exact bytes the worker rejected.
 */
function inspectDlq(stage) {
  for (const [sub, label] of [[CFG.dlqUploaded, "file-uploaded"], [CFG.dlqConvert, "convert-requested"]]) {
    const pulled = gcloud(["pubsub", "subscriptions", "pull", sub, "--limit=5"], { allowFail: true })
    if (pulled === null) {
      record(stage, null, `DLQ ${sub}`, "could not pull — subscription missing or no permission")
      continue
    }
    if (pulled.length === 0) {
      record(stage, true, `DLQ ${label} is empty`, null)
      continue
    }
    const decoded = pulled.map((m) => {
      const attrs = m.message?.attributes ?? {}
      const data = m.message?.data ? Buffer.from(m.message.data, "base64").toString("utf8") : "(no data)"
      const from = attrs.CloudPubSubDeadLetterSourceSubscription ?? "?"
      const tries = attrs.CloudPubSubDeadLetterSourceDeliveryCount ?? "?"
      return `${m.message?.publishTime ?? "?"}  from ${from} after ${tries} attempts\n          ${data}`
    })
    record(stage, false, `DLQ ${label} holds ${pulled.length} dead message(s)`,
      decoded.join("\n        ") + `\n        These were retried to exhaustion. The payload above is what the worker refused.`)
  }
}

/* ----------------------------------------------------------------- phase 4 */

async function waitForSchemas(ctx) {
  section("3 · Schema detection — poll until the worker writes a shape")

  const deadline = Date.now() + CFG.schemaTimeoutMs
  let last = null

  while (Date.now() < deadline) {
    const polled = await post("/api/polling/schema", { userId: ctx.userId, requestId: ctx.requestId, received: [] })
    if (polled.status !== 200) {
      record("schema", false, "POST /api/polling/schema", `${polled.status} ${polled.raw.slice(0, 200)}`)
      return null
    }
    last = polled.body

    const entries = last.files ?? last.entries ?? []
    if (entries.length > 0) {
      const ready = entries.filter((e) => e.status === "ready")
      const failed = entries.filter((e) => e.status === "failed")

      for (const e of failed) {
        record("schema", false, `${e.fileName} failed inspection`,
          `class ${e.failure?.class ?? "?"} — ${e.failure?.message ?? "no message"}`)
      }
      for (const e of ready) {
        const fields = (e.schema?.fields ?? []).map((f) => `${f.key}:${f.type}`).join(", ")
        record("schema", true, `${e.fileName} → schema ${e.schemaId}`,
          `v${e.schema?.version} shapeHash ${e.schema?.shapeHash}\n        fields: ${fields}`)
        const missingOrigin = (e.schema?.fields ?? []).filter((f) => !f.origin)
        if (missingOrigin.length > 0) {
          record("schema", null, "detected fields carry no `origin`",
            `${missingOrigin.length} field(s). The "added by you" marker will never render until the first edit re-derives it.`)
        }
      }
      return last
    }

    process.stdout.write(`  ${C.dim}waiting… pending ${last.pending ?? "?"}  (${Math.round((deadline - Date.now()) / 1000)}s left)${C.off}\r`)
    await sleep(CFG.pollIntervalMs)
  }

  console.log("")
  record("schema", false, "no schema arrived before the timeout",
    `${CFG.schemaTimeoutMs / 1000}s elapsed, pending ${last?.pending ?? "?"}.\n        The file is still UPLOADED: the detector never moved it, so nothing failed and nothing succeeded.`)
  return null
}

/* ----------------------------------------------------------------- phase 5 */

async function convertAndWait(ctx) {
  section("4 · Conversion — gate, publish, poll the result")

  const requested = await post("/api/convert", { userId: ctx.userId, requestId: ctx.requestId })
  record("convert", requested.status === 200, "POST /api/convert",
    requested.status === 200
      ? `queued ${requested.body?.queued}, skipped ${requested.body?.skipped}`
      : `${requested.status} ${requested.raw.slice(0, 300)}`)
  if (requested.status !== 200) return null

  const deadline = Date.now() + CFG.resultTimeoutMs
  let last = null

  while (Date.now() < deadline) {
    const polled = await post("/api/polling/result", { userId: ctx.userId, requestId: ctx.requestId })
    if (polled.status !== 200) {
      record("convert", false, "POST /api/polling/result", `${polled.status} ${polled.raw.slice(0, 200)}`)
      return null
    }
    last = polled.body
    const c = last.counts ?? {}
    const settled = (c.done ?? 0) + (c.failed ?? 0)
    const total = (c.queued ?? 0) + (c.extracting ?? 0) + (c.filling ?? 0) + settled

    if (total > 0 && settled === total) {
      console.log("")
      for (const entry of last.entries ?? []) {
        record("convert", entry.stage !== "FAILED", `${entry.fileName} → ${entry.stage}`,
          entry.stage === "FAILED"
            ? `class ${entry.failure?.class ?? "?"} — ${entry.failure?.message ?? "no message"}`
            : `${entry.rowCount} rows, ${entry.fieldCount} fields`)
      }
      // A table that reports DONE with no rows has not been converted; it has
      // had its result row written at detection time and never touched again.
      const hollow = (last.entries ?? []).filter((e) => e.stage === "DONE" && e.rowCount === 0)
      if (hollow.length > 0) {
        record("convert", null, `${hollow.length} table(s) are DONE with 0 rows`,
          "file_schema_results was marked DONE without any row_count being written. The progress UI will show a finished conversion that never ran.")
      }
      return last
    }

    process.stdout.write(`  ${C.dim}queued ${c.queued ?? 0} · extracting ${c.extracting ?? 0} · filling ${c.filling ?? 0} · done ${c.done ?? 0} · failed ${c.failed ?? 0}  (${Math.round((deadline - Date.now()) / 1000)}s left)${C.off}\r`)
    await sleep(CFG.pollIntervalMs)
  }

  console.log("")
  record("convert", false, "conversion did not settle before the timeout",
    `counts ${JSON.stringify(last?.counts ?? {})}`)
  return last
}

/* ------------------------------------------------------------------ report */

function report() {
  section("Summary")

  const failed = findings.filter((f) => f.ok === false)
  const warned = findings.filter((f) => f.ok === null)
  const passed = findings.filter((f) => f.ok === true)

  console.log(`  ${C.green}${passed.length} passed${C.off}   ${C.yellow}${warned.length} warnings${C.off}   ${C.red}${failed.length} failed${C.off}`)

  if (failed.length > 0) {
    console.log(`\n${C.red}${C.bold}  Failures${C.off}`)
    for (const f of failed) console.log(`    · [${f.stage}] ${f.label}`)
  }

  console.log("")
  return failed.length === 0 ? 0 : 1
}

/* -------------------------------------------------------------------- main */

async function main() {
  console.log(`${C.bold}Quarry end-to-end — real infrastructure${C.off}`)
  note(`app      ${CFG.baseUrl}`)
  note(`project  ${CFG.project}  region ${CFG.region}  bucket ${CFG.bucket}`)

  preflight()
  if (CFG.preflightOnly) process.exit(report())

  const fixture = makeFixture()
  const startedAt = new Date(Date.now() - 60_000).toISOString()

  const ctx = await uploadFlow(fixture)
  if (!ctx) process.exit(report())

  verifyObject(ctx)

  section("2a · The wire — what the backend actually published")
  tapTopic(CFG.tapUploaded, CFG.topicUploaded, ctx.fileId, "wire")

  section("3a · Cloud Run — did the detector get the push?")
  // Pub/Sub delivery plus a Cloud Run cold start is not instant, and a log
  // that has not been ingested yet reads exactly like one that never existed.
  await sleep(15_000)
  inspectWorkerLogs(CFG.inspectService, startedAt, "schema")

  await waitForSchemas(ctx)

  if (!CFG.skipConvert) {
    const convertStartedAt = new Date(Date.now() - 30_000).toISOString()
    await convertAndWait(ctx)
    section("4a · The wire and Cloud Run — conversion")
    tapTopic(CFG.tapConvert, CFG.topicConvert, ctx.fileId, "convert")
    await sleep(10_000)
    inspectWorkerLogs(CFG.convertService, convertStartedAt, "convert")
  }

  section("5 · Dead-letter queues")
  inspectDlq("dlq")

  note(`requestId ${ctx.requestId} — keep it to re-poll or to query the database`)
  process.exit(report())
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith("--")) {
      out[key] = next
      i += 1
    } else {
      out[key] = true
    }
  }
  return out
}

main().catch((error) => {
  console.error(`\n${C.red}${error.stack ?? error.message}${C.off}\n`)
  process.exit(2)
})
