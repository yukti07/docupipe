#!/usr/bin/env node
/**
 * Switch the app between the real backend and sample data.
 *
 *   npm run fixtures           say which mode is on now
 *   npm run fixtures:off       the real backend, and nothing invented
 *   npm run fixtures:on        sample data everywhere — no Postgres, worker or bucket
 *   npm run fixtures:mixed     the real backend, plus sample data for the five
 *                              surfaces that have no route yet
 *
 * All it does is set two flags in `.env.local`. `next dev` watches that file and
 * restarts itself, so a running dev server picks the change up on its own —
 * there is nothing to rebuild and no code to edit.
 *
 * `.env.local` holds real credentials, so this rewrites the two lines it owns
 * and leaves every other byte, comment and blank line exactly where it was.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const ENV = join(dirname(dirname(fileURLToPath(import.meta.url))), ".env.local")

const ALL = "NEXT_PUBLIC_FIXTURES"
const FALLBACK = "NEXT_PUBLIC_FIXTURE_FALLBACK"

/** What each mode sets. Read `lib/api/index.ts` for what the app does with them. */
const MODES = {
  off: { [ALL]: "0", [FALLBACK]: "0" },
  on: { [ALL]: "1", [FALLBACK]: "0" },
  mixed: { [ALL]: "0", [FALLBACK]: "1" },
}

const DESCRIBE = {
  off: [
    "LIVE — the real backend.",
    "Upload, schemas and convert are real. The table, evidence, raw-text and merge",
    "screens have no endpoint yet and say so rather than invent rows.",
  ],
  on: [
    "FIXTURES — sample data everywhere.",
    "No database, worker or bucket is touched, and nothing on screen belongs to anyone.",
  ],
  mixed: [
    "MIXED — the real backend, with sample data filling the gaps.",
    "Upload, schemas and convert are real. The table, evidence, raw-text and merge",
    "screens show sample rows under your own batch — convenient, and easy to mistake",
    "for real output. This is what the app did before the modes existed.",
  ],
}

const BLOCK = (mode) => `
# ------------------------------------------------------------------ fixtures
# Which backend the app talks to — see lib/api/index.ts. Flip these with
# \`npm run fixtures:on\` / \`:off\` / \`:mixed\` rather than by hand.
${ALL}=${MODES[mode][ALL]}
${FALLBACK}=${MODES[mode][FALLBACK]}
`

const arg = (process.argv[2] ?? "status").toLowerCase()
if (!["status", ...Object.keys(MODES)].includes(arg)) {
  console.error(`usage: node scripts/use-fixtures.mjs [on|off|mixed]\n`)
  process.exit(2)
}

const existing = existsSync(ENV) ? readFileSync(ENV, "utf8") : ""
const current = modeOf(existing)

if (arg === "status") {
  report(current)
  process.exit(0)
}

if (arg === current) {
  console.log("Already there.")
  report(current)
  process.exit(0)
}

// Once both lines are in the file they are replaced where they stand, so it
// keeps whatever order it grew in. Before that, any half-written attempt is
// cleared out and the block is appended whole.
const next = setBoth(existing)
  ? Object.entries(MODES[arg]).reduce(
      (text, [key, value]) => text.replace(lineFor(key), `${key}=${value}`),
      existing,
    )
  : [ALL, FALLBACK].reduce((text, key) => text.replace(lineFor(key, true), ""), existing).trimEnd() +
    BLOCK(arg)

writeFileSync(ENV, next, "utf8")
report(arg)
console.log("\n  .env.local updated. A running `next dev` restarts itself; otherwise start it now.")

/** The setting's own line, commented out or not. `withNewline` swallows the break too. */
function lineFor(key, withNewline = false) {
  return new RegExp(`^[ \\t]*#?[ \\t]*${key}[ \\t]*=.*$${withNewline ? "\\n?" : ""}`, "m")
}

/** Both flags already have a line of their own, so replacing in place is enough. */
function setBoth(text) {
  return [ALL, FALLBACK].every((key) => lineFor(key).test(text))
}

/** The mode as the app will read it — a flag only counts when set to exactly "1". */
function modeOf(text) {
  const on = (key) => {
    const line = text.split(/\r?\n/).find((l) => new RegExp(`^[ \\t]*${key}[ \\t]*=`).test(l))
    return line !== undefined && line.split("=")[1]?.trim() === "1"
  }
  if (on(ALL)) return "on"
  return on(FALLBACK) ? "mixed" : "off"
}

function report(mode) {
  console.log(`\n  ${DESCRIBE[mode].join("\n  ")}`)
}
