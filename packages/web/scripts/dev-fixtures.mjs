import { spawn } from "node:child_process"

/**
 * `next dev` with NEXT_PUBLIC_FIXTURES=1 — the UI on fixtures, with no
 * Postgres, no worker and no bucket behind it. See src/lib/api/index.ts.
 *
 * A script rather than an inline env prefix because `FOO=1 next dev` is not a
 * thing on Windows, and this repo builds on both.
 */
const child = spawn("next", ["dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NEXT_PUBLIC_FIXTURES: "1" },
})

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
