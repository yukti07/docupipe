/**
 * The check runner.
 *
 * Every check reports one of four things, and the distinction matters:
 *
 *   PASS   it works
 *   FAIL   it is broken, and `fix` says what to do about it
 *   WARN   it works but is not what we intended (a wide-open CORS in prod)
 *   SKIP   it could not be checked from here, and why
 *
 * A check that cannot run is never a PASS. Half the value of this script is
 * refusing to claim something was verified when it was not.
 */

const C = process.stdout.isTTY
  ? {
      reset: "[0m",
      dim: "[2m",
      bold: "[1m",
      red: "[31m",
      green: "[32m",
      yellow: "[33m",
      blue: "[34m",
      grey: "[90m",
    }
  : new Proxy({}, { get: () => "" })

export const MARK = {
  pass: `${C.green}PASS${C.reset}`,
  fail: `${C.red}FAIL${C.reset}`,
  warn: `${C.yellow}WARN${C.reset}`,
  skip: `${C.grey}SKIP${C.reset}`,
}

export class Report {
  constructor({ verbose = false } = {}) {
    this.verbose = verbose
    this.results = []
    this.currentGroup = null
  }

  group(name) {
    this.currentGroup = name
    process.stdout.write(`\n${C.bold}${name}${C.reset}\n`)
  }

  #record(status, title, detail, fix) {
    this.results.push({ group: this.currentGroup, status, title, detail, fix })
    const line = `  ${MARK[status]}  ${title}`
    process.stdout.write(detail ? `${line}\n        ${C.dim}${detail}${C.reset}\n` : `${line}\n`)
    if (status === "fail" && fix) {
      process.stdout.write(`        ${C.yellow}fix:${C.reset} ${fix.replace(/\n/g, "\n             ")}\n`)
    }
  }

  pass(title, detail) {
    this.#record("pass", title, detail)
  }

  fail(title, detail, fix) {
    this.#record("fail", title, detail, fix)
  }

  warn(title, detail) {
    this.#record("warn", title, detail)
  }

  skip(title, reason) {
    this.#record("skip", title, reason)
  }

  /**
   * Run one check. An exception is a FAIL, never a crash — one broken thing
   * must not stop the rest of the report, because the whole point is to see
   * everything that is wrong in one pass.
   */
  async check(title, fn, { fix } = {}) {
    try {
      const outcome = await fn()
      if (outcome && outcome.skip) return this.skip(title, outcome.skip)
      if (outcome && outcome.warn) return this.warn(title, outcome.warn)
      return this.pass(title, outcome && outcome.detail)
    } catch (error) {
      const detail = error && error.message ? error.message.split("\n")[0] : String(error)
      return this.fail(title, detail, error.fix ?? fix)
    }
  }

  summary() {
    const count = (s) => this.results.filter((r) => r.status === s).length
    const [p, f, w, s] = [count("pass"), count("fail"), count("warn"), count("skip")]

    process.stdout.write(
      `\n${C.bold}${p} passed${C.reset}` +
        (f ? `, ${C.red}${f} failed${C.reset}` : ", 0 failed") +
        (w ? `, ${C.yellow}${w} warnings${C.reset}` : "") +
        (s ? `, ${C.grey}${s} skipped${C.reset}` : "") +
        "\n",
    )

    if (f > 0) {
      process.stdout.write(`\n${C.red}${C.bold}Not ready.${C.reset} Failing checks:\n`)
      for (const r of this.results.filter((x) => x.status === "fail")) {
        process.stdout.write(`  · ${r.group} — ${r.title}\n`)
      }
    }
    if (s > 0 && f === 0) {
      process.stdout.write(
        `\n${C.grey}Skipped checks were not verified. They are not passes.${C.reset}\n`,
      )
    }
    return f === 0 ? 0 : 1
  }
}

/** Raise a failure that carries its own remediation. */
export function failure(message, fix) {
  const error = new Error(message)
  error.fix = fix
  return error
}

export const colors = C
