#!/usr/bin/env node
/**
 * Quarry — GCP preflight.
 *
 * Proves real connectivity and real IAM against a deployed project. It is
 * DETACHED from the application: it imports none of the app's code, shares
 * none of its configuration objects, and has its own dependencies. If it and
 * the app disagree, that disagreement is the finding.
 *
 * It exists because almost every failure in this architecture is silent. A
 * missing token-creator binding, a bucket with no CORS, a dead-letter policy
 * with no grants behind it, a scheduler job that was never enabled — none of
 * them produce an error anywhere until a user hits them.
 *
 *   node preflight.mjs --from-terraform
 *
 * Exit code is 0 only if nothing failed. Skipped checks are NOT passes.
 */

// A transitive dependency still pulls in `punycode`; its deprecation notice is
// noise in a tool whose whole output is meant to be read carefully.
process.removeAllListeners("warning")
process.on("warning", (w) => {
  if (w.name !== "DeprecationWarning") process.emitWarning(w)
})

import { Report, colors } from "./lib/report.mjs"
import { USAGE, loadConfig, parseArgs } from "./lib/config.mjs"
import * as identity from "./lib/checks/identity.mjs"
import * as storage from "./lib/checks/storage.mjs"
import * as cloudsql from "./lib/checks/cloudsql.mjs"
import * as pubsub from "./lib/checks/pubsub.mjs"
import { runApis, runScheduler, runSecrets, runServices } from "./lib/checks/services.mjs"

const GROUPS = {
  identity: (r, c, s) => identity.run(r, c, s),
  apis: (r, c, s) => runApis(r, c, s),
  storage: (r, c, s) => storage.run(r, c, s),
  sql: (r, c, s) => cloudsql.run(r, c, s),
  pubsub: (r, c, s) => pubsub.run(r, c, s),
  run: (r, c, s) => runServices(r, c, s),
  secrets: (r, c) => runSecrets(r, c),
  scheduler: (r, c, s) => runScheduler(r, c, s),
}

async function main() {
  const argv = parseArgs(process.argv.slice(2))

  if (argv.help) {
    process.stdout.write(USAGE)
    return 0
  }

  let cfg
  try {
    cfg = loadConfig(argv)
  } catch (error) {
    process.stderr.write(`\n${colors.red}${error.message}${colors.reset}\n`)
    if (error.fix) process.stderr.write(`\n${error.fix}\n`)
    return 2
  }

  const report = new Report({ verbose: argv.verbose })

  process.stdout.write(
    `${colors.bold}Quarry GCP preflight${colors.reset}\n` +
      `${colors.dim}project ${cfg.projectId} · region ${cfg.region}` +
      `${cfg.readOnly ? " · read-only" : ""}${colors.reset}\n`,
  )

  if (!cfg.readOnly) {
    process.stdout.write(
      `${colors.dim}writes: one GCS object under ${cfg.prefix}/, one message per topic, ` +
        `one temp table — all cleaned up${colors.reset}\n`,
    )
  }

  // Identity always runs first: everything below it needs credentials, and a
  // failure here explains most of what would follow.
  const requested = argv.only ?? Object.keys(GROUPS)
  const order = ["identity", ...requested.filter((g) => g !== "identity")]

  const unknown = requested.filter((g) => !GROUPS[g])
  if (unknown.length) {
    process.stderr.write(`\nUnknown group(s): ${unknown.join(", ")}\n`)
    process.stderr.write(`Known: ${Object.keys(GROUPS).join(", ")}\n`)
    return 2
  }

  const state = {}
  for (const name of order) {
    try {
      await GROUPS[name](report, cfg, state)
    } catch (error) {
      // A group that throws outside a check is itself a failure, not a crash.
      report.group(name)
      report.fail(`${name} checks could not run`, error.message, error.fix)
    }
  }

  // Make sure a half-finished SQL check never leaves a connection open.
  if (state.sqlPool) await state.sqlPool.end().catch(() => {})
  if (state.sqlConnector) state.sqlConnector.close()

  return report.summary()
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`\nunexpected: ${error?.stack ?? error}\n`)
    process.exit(3)
  })
